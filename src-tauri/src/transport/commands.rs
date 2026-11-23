use futures::lock::Mutex;
use futures::Sink;
use futures::SinkExt;

use futures::channel::mpsc::SendError;

use serde::{Deserialize, Serialize};

use tauri::ipc::InvokeBody;
use tauri::{command, ipc::Request, State};

type ActiveSink<'a> = Box<dyn Sink<Vec<u8>, Error = SendError> + Unpin + Send + 'a>;

#[derive(Debug, Serialize, Deserialize)]
pub struct AvailableDevice {
    pub label: String,
    pub id: String,
}

#[derive(Debug, Default)]
pub struct ActiveConnection<'a> {
    pub conn: Mutex<Option<ActiveSink<'a>>>,
}

#[command]
pub async fn transport_send_data(
    req: Request<'_>,
    state: State<'_, ActiveConnection<'_>>,
) -> Result<(), ()> {
    if let InvokeBody::Raw(data) = req.body() {
        let mut lock = state.conn.lock().await;

        let sink = lock.as_mut().unwrap();
        let _ = sink.send(data.clone()).await;
    }

    Ok(())
}

#[command]
pub async fn transport_close(
    _req: Request<'_>,
    state: State<'_, ActiveConnection<'_>>,
) -> Result<(), ()> {
    *state.conn.lock().await = None;

    Ok(())
}
