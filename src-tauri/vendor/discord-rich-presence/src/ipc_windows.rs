use crate::discord_ipc::DiscordIpc;
use serde_json::json;
use std::{
    error::Error,
    fs::{File, OpenOptions},
    io::{Read, Write},
    os::windows::fs::OpenOptionsExt,
    os::windows::io::AsRawHandle,
    path::PathBuf,
};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[allow(dead_code)]
#[derive(Debug)]
/// A wrapper struct for the functionality contained in the
/// underlying [`DiscordIpc`](trait@DiscordIpc) trait.
pub struct DiscordIpcClient {
    /// Client ID of the IPC client.
    pub client_id: String,
    connected: bool,
    socket: Option<File>,
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
}

impl DiscordIpc for DiscordIpcClient {
    fn connect_ipc(&mut self) -> Result<()> {
        for i in 0..10 {
            let path = PathBuf::from(format!(r"\\?\pipe\discord-ipc-{}", i));

            match OpenOptions::new().access_mode(0x3).open(&path) {
                Ok(handle) => {
                    self.socket = Some(handle);
                    return Ok(());
                }
                Err(_) => continue,
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

        let mut available: u32 = 0;
        // SAFETY: the handle is a valid named pipe handle for the lifetime of
        // `socket`, and the out-parameter is a valid pointer to a u32.
        let ok = unsafe {
            windows_sys::Win32::System::Pipes::PeekNamedPipe(
                socket.as_raw_handle(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                &mut available,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().into());
        }

        Ok(available > 0)
    }

    fn close(&mut self) -> Result<()> {
        let data = json!({});
        if self.send(data, 2).is_ok() {}

        let socket = self.socket.as_mut().ok_or(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "Couldn't retrieve the Discord IPC socket",
        ))?;
        socket.flush()?;

        Ok(())
    }

    fn get_client_id(&self) -> &String {
        &self.client_id
    }
}
