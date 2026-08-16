use crate::discord_ipc::DiscordIpc;
use serde_json::json;
use std::os::unix::io::AsRawFd;
use std::os::unix::net::UnixStream;
use std::{
    env::var,
    error::Error,
    io::{Read, Write},
    net::Shutdown,
    path::PathBuf,
};

// Environment keys to search for the Discord pipe
const ENV_KEYS: [&str; 4] = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"];

const APP_SUBPATHS: [&str; 4] = [
    "",
    "app/com.discordapp.Discord/",
    "snap.discord-canary/",
    "snap.discord/",
];

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[allow(dead_code)]
#[derive(Debug)]
/// A wrapper struct for the functionality contained in the
/// underlying [`DiscordIpc`](trait@DiscordIpc) trait.
pub struct DiscordIpcClient {
    /// Client ID of the IPC client.
    pub client_id: String,
    connected: bool,
    socket: Option<UnixStream>,
}

impl DiscordIpcClient {
    /// Creates a new `DiscordIpcClient`.
    ///
    /// # Examples
    /// ```
    /// let ipc_client = DiscordIpcClient::new("<some client id>")?;
    /// ```
    pub fn new(client_id: &str) -> Result<Self> {
        let client = Self {
            client_id: client_id.to_string(),
            connected: false,
            socket: None,
        };

        Ok(client)
    }

    fn get_pipe_pattern() -> PathBuf {
        let mut path = String::new();

        for key in &ENV_KEYS {
            match var(key) {
                Ok(val) => {
                    path = val;
                    break;
                }
                Err(_e) => continue,
            }
        }
        PathBuf::from(path)
    }
}

impl DiscordIpc for DiscordIpcClient {
    fn connect_ipc(&mut self) -> Result<()> {
        for i in 0..10 {
            for subpath in APP_SUBPATHS {
                let path = DiscordIpcClient::get_pipe_pattern()
                    .join(subpath)
                    .join(format!("discord-ipc-{}", i));

                match UnixStream::connect(&path) {
                    Ok(socket) => {
                        self.socket = Some(socket);
                        return Ok(());
                    }
                    Err(_) => continue,
                }
            }
        }

        Err("Couldn't connect to the Discord IPC socket".into())
    }

    fn write(&mut self, data: &[u8]) -> Result<()> {
        let socket = self.socket.as_mut().ok_or(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "Couldn't retrieve the Discord IPC socket",
        ))?;

        socket.write_all(data)?;

        Ok(())
    }

    fn read(&mut self, buffer: &mut [u8]) -> Result<()> {
        let socket = self.socket.as_mut().ok_or(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "Couldn't retrieve the Discord IPC socket",
        ))?;

        socket.read_exact(buffer)?;

        Ok(())
    }

    fn has_pending_frame(&mut self) -> Result<bool> {
        let socket = self.socket.as_ref().ok_or(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "Couldn't retrieve the Discord IPC socket",
        ))?;

        let mut fds = libc::pollfd {
            fd: socket.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: `fds` points to a single valid pollfd and the timeout is 0
        // (pure poll, never blocks).
        let ready = unsafe { libc::poll(&mut fds, 1, 0) };
        if ready < 0 {
            return Err(std::io::Error::last_os_error().into());
        }

        Ok(ready > 0)
    }

    fn close(&mut self) -> Result<()> {
        let data = json!({});
        if self.send(data, 2).is_ok() {}

        let socket = self.socket.as_mut().ok_or(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "Couldn't retrieve the Discord IPC socket",
        ))?;

        socket.flush()?;
        match socket.shutdown(Shutdown::Both) {
            Ok(()) => (),
            Err(_err) => (),
        };

        Ok(())
    }

    fn get_client_id(&self) -> &String {
        &self.client_id
    }
}
