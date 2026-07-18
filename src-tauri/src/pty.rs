use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    stop: Arc<AtomicBool>,
}

impl PtySession {
    pub fn spawn(
        program: &str,
        args: &[String],
        cwd: &str,
        cols: u16,
        rows: u16,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> Result<PtySession, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave); // release the slave so EOF is delivered on child exit

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        // Reader thread: stream output, call on_exit once on EOF/error.
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut on_exit = Some(on_exit);
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => on_output(buf[..n].to_vec()),
                    Err(_) => break,
                }
            }
            if let Some(cb) = on_exit.take() {
                cb();
            }
        });

        Ok(PtySession {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            stop: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock().map_err(|e| e.to_string())?;
        w.write_all(data).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.lock().map_err(|e| e.to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn echo_hi_reaches_the_output_callback() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let _session = PtySession::spawn(
            "bash",
            &["-c".into(), "echo hi".into()],
            "/tmp",
            24,
            80,
            move |bytes| {
                let _ = tx.send(bytes);
            },
            || {},
        )
        .expect("spawn should succeed");

        // Collect output for up to 3 seconds; assert we saw "hi".
        let mut acc = Vec::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            if let Ok(mut chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                acc.append(&mut chunk);
                if String::from_utf8_lossy(&acc).contains("hi") {
                    return;
                }
            }
        }
        panic!("never saw 'hi'; got: {:?}", String::from_utf8_lossy(&acc));
    }
}
