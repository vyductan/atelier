use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::main]
async fn main() {
    let cwd = std::path::PathBuf::from("/Users/vyductan/.atelier");
    let mut child = match tokio::process::Command::new("claude")
        .args(&[
            "--verbose",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
        ])
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            println!("Spawn err: {}", e);
            return;
        }
    };

    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();

    let write_task = tokio::spawn(async move {
        let line = "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"test\"}}\n".to_string();
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        if let Err(e) = stdin.write_all(line.as_bytes()).await {
            println!("stdin write err: {}", e);
        }
        if let Err(e) = stdin.flush().await {
            println!("stdin flush err: {}", e);
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(3000)).await;
        // do not close stdin
    });

    let mut out_str = String::new();
    let mut err_str = String::new();
    
    let out_task = tokio::spawn(async move {
        stdout.read_to_string(&mut out_str).await.unwrap_or_default();
        out_str
    });
    
    let err_task = tokio::spawn(async move {
        stderr.read_to_string(&mut err_str).await.unwrap_or_default();
        err_str
    });

    let status = child.wait().await.unwrap();
    let out_res = out_task.await.unwrap();
    let err_res = err_task.await.unwrap();
    
    println!("Status: {}\nSTDOUT: {}\nSTDERR: {}", status, out_res, err_res);
}
