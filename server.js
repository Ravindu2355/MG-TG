const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { File } = require('megajs');

/* RETRYING SYSTEM */
File.defaultHandleRetries = (tries, error, cb) => {
  if (tries > 5) {
    console.log("❌ Giving up after retries");
    cb(error);
  } else {
    console.log(`🔁 Retry ${tries}`);
    setTimeout(cb, 1000 * Math.pow(2, tries));
  }
};

const app = express();
const PORT = 8000;
const maxSize = 1500 * 1024 * 1024; // 1500MB

const this_server = "https://unfair-carolin-dhyi-2885f9fd.koyeb.app";
const bot_server = "https://joyous-locust-gimhan-3992e08d.koyeb.app";
let upload_chat = "-1003875761551";

let queue = [];
let isProcessing = false;

//for band width errors
let isPaused = false;
let bandwidthSleep = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
//---------------------

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const JSON_FILE = path.join(__dirname, 'files.json');

fs.ensureDirSync(DOWNLOAD_DIR);

let extractedFiles = [];

let downloadStatus = {
  status: "idle",
  file: null,
  progress: 0,
  speed: null,
  done: false
};

function cleanNode(node) {
  //console.log(node);
  return {
    name: node.name,
    size: node.size,
    type: node.directory ? "folder" : "file",
    children: node.children
      ? node.children.map(cleanNode)
      : undefined,
    downloadId:node.downloadId
  };
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}
  
/* ---------------------------
   Extract Mega Folder
--------------------------- */
function walk(node, results, pathStr = '') {
  if (node.directory) {
    if (node.children) {
      node.children.forEach(child => {
        walk(child, results, `${pathStr}${node.name}/`);
      });
    }
  } else {
    results.push({
      name: node.name,
      size: node.size,
      path: pathStr,
      isVideo: /\.(mp4|mkv|avi|mov|webm)$/i.test(node.name),
      node:cleanNode(node)
    });
  }
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  
  isProcessing = true;

  while (queue.length > 0) {
    const file = queue[0]; // 👈 DON'T shift yet
    if (isPaused) {
      console.log("⏸️ Waiting for bandwidth reset...");
      await sleep(5000);
      continue;
    }
    const savePath = path.join(DOWNLOAD_DIR, file.name);
    const fileUrl = `${this_server}/download/${encodeURIComponent(file.name)}`;
    if (file.size > maxSize) {
       console.log("❌ Skipped (too large):", file.name);
       queue.shift();   // remove this file
       continue;        // move to next
    }
    if (file.size == 0) {
       console.log("❌ Skipped (0 bytes):", file.name);
       queue.shift();   // remove this file
       continue;        // move to next
    }
    try {
      console.log("🚀 Processing:", file.name, formatBytes(file.size));

      /* -------- DOWNLOAD (only if not exists) -------- */
      if (!fs.existsSync(savePath)) {
        const megaFol = File.fromURL(file.url);
        const megaFile = await megaFol.loadAttributes();

        const stream = await megaFile.download();
        const writeStream = fs.createWriteStream(savePath);

        /*await new Promise((resolve, reject) => {
          stream.pipe(writeStream);
          stream.on('error', reject);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });*/

        /**/
        let downloaded = 0;
        let startTime = Date.now();

        downloadStatus = {
          status: "downloading",
          file: file.name,
          progress: 0,
          speed: "0 MB/s",
          done: false
        };

        await new Promise((resolve, reject) => {
          stream.on('data', (chunk) => {
            downloaded += chunk.length;

            const percent = ((downloaded / file.size) * 100).toFixed(2);
            const elapsed = (Date.now() - startTime) / 1000;

            const speed = elapsed > 0 ? (downloaded / 1024 / 1024 / elapsed).toFixed(2) + " MB/s" : "0 MB/s";

            downloadStatus.progress = Number(percent);
            downloadStatus.speed = speed;
          });

          stream.on('error', reject);
          writeStream.on('error', reject);

          writeStream.on('finish', () => {
            downloadStatus.status = "finished";
            downloadStatus.progress = 100;
            downloadStatus.done = true;

            console.log("✅ Download complete");
            resolve();
          });

          stream.pipe(writeStream);
        });
        /**/

        console.log("✅ Downloaded");
      } else {
        console.log("📁 File already exists, skipping download");
      }

      /* -------- SEND TO BOT -------- */
      await fetch(`${bot_server}/add_task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: fileUrl,
          chat_id: upload_chat,
          type: "direct"
        })
      });

      console.log("📤 Sent to bot");

      /* -------- CHECK STATUS LOOP -------- */
      let done = false;
      let tries = 0;

      while (!done && tries < 200) { // 👈 LIMIT (important)
        await new Promise(r => setTimeout(r, 3000));
        tries++;

        try {
          const res = await fetch(`${bot_server}/megaV?url=${encodeURIComponent(fileUrl)}`);
          const data = await res.json();

          console.log("📡 Status:", data.status);

          if (data.status === 0) {
            // ✅ SUCCESS
            console.log("File Uploaded!✅")
            done = true;

            fs.removeSync(savePath);
            console.log("🧹 Deleted file");

            queue.shift(); // 👈 NOW remove from queue
          }

          if (data.status === 1) {
            console.log("🔁 Retry needed...");
            // ❗ DO NOTHING → loop again
          }

        } catch (e) {
          console.log("⚠️ Status check failed");
        }
      }

      if (!done) {
        console.log("❌ Max retries reached, skipping...");
        if (fs.existsSync(savePath)) {
           fs.removeSync(savePath);
        }
        queue.shift();
      }

    } catch (err) {
      console.error("❌ Error:", err.message);

      //Band wdth err
      const msg = err.message || "";

      // 🔍 Detect bandwidth limit
      const match = msg.match(/(\d+)\s*seconds/);

      if (msg.includes("Bandwidth limit") && match) {
        const seconds = parseInt(match[1], 10);

        const waitTime = (seconds + 2) * 1000; // +2 sec buffer

        console.log(`⛔ Bandwidth hit. Sleeping for ${seconds + 2} seconds`);

        isPaused = true;
        bandwidthSleep = waitTime;
        
        setTimeout(() => {
          isPaused = false;
          console.log("▶️ Resuming queue...");
        }, waitTime);

      } else {
        // ❗ Other errors → skip file
        if (fs.existsSync(savePath)) {
           fs.removeSync(savePath);
        }
        queue.shift();
      }
      //-------
      
    }
  }

  isProcessing = false;
}

async function startQueueWorker() {
  console.log("👷 Queue worker started");

  while (true) {
    try {
      if (!isProcessing && queue.length > 0) {
        await processQueue();
      }
    } catch (err) {
      console.error("❌ Worker error:", err.message);
    }

    // small delay to prevent CPU overuse
    await new Promise(r => setTimeout(r, 2000));
  }
}

app.get('/', (req, res) => {
  res.send(`Hello World paused:${isPaused} for time:${bandwidthSleep}s`);
});

app.get("/skip", (req, res) => {
  let count = parseInt(req.query.count, 10) || 1;

  if (count < 1) count = 1;

  if (count > queue.length) {
    count = queue.length;
  }

  const skipped = queue.splice(0, count);

  console.log(`⏭️ Skipped ${count} items`);

  res.json({
    success: true,
    skipped: skipped.length,
    remaining: queue.length
  });
});
/* ---------------------------
   EXTRACT
--------------------------- */
app.get('/extract', async (req, res) => {
  try {
    const url = req.query.url;

    if (!url) return res.send("❌ Missing URL");

    console.log("🚀 Extracting:", url);

    const folder = await File.fromURL(url).loadAttributes();

    extractedFiles = [];
    walk(folder, extractedFiles);

    for(const f of extractedFiles){
      if(f.isVideo){
        queue.push(f);
      }
    }

    extractedFiles=extractedFiles.map(ex=>{
     ex.url=`${url}/file/${ex.node.downloadId[1]}`;
     return ex;
    })

    fs.writeJsonSync(JSON_FILE, extractedFiles, { spaces: 2 });

    res.send({
      message: "✅ Extracted",
      total: extractedFiles.length,
      json: "/json"
    });

  } catch (err) {
    console.error(err);
    res.send("❌ Error extracting");
  }
});

/* ---------------------------
   DOWNLOAD check
--------------------------- */
app.get('/download-status', (req, res) => {
  res.json(downloadStatus);
});
/* ---------------------------
   UPLOAD CHECK
--------------------------- */
app.get('/upload-status', (req, res) => {
  const filePath = path.join(__dirname, 'upload-status.json');

  if (!fs.existsSync(filePath)) {
    return res.json({ status: "no data" });
  }
  
  res.sendFile(filePath);
});
/* ---------------------------
   DOWNLOAD JSON
--------------------------- */
app.get('/json', (req, res) => {
  if (!fs.existsSync(JSON_FILE)) {
    return res.send("❌ No JSON found");
  }
  res.download(JSON_FILE);
});

/* ---------------------------
   GET FILE DATA (only needed part)
--------------------------- */
app.get('/file', (req, res) => {
  const index = parseInt(req.query.index);

  if (isNaN(index)) return res.send("❌ Invalid index");

  const data = extractedFiles[index];

  if (!data) return res.send("❌ File not found");

  // only send needed info
  res.json({
    name: data.name,
    size: data.size,
    isVideo: data.isVideo
  });
});

/* ---------------------------
   DOWNLOAD FILE (<=1500MB)
--------------------------- */
app.get('/download', async (req, res) => {
  try {
    const index = parseInt(req.query.index);

    const file = extractedFiles[index];

    if (!file) return res.send("❌ File not found");

    if (file.size > maxSize) {
      return res.send("❌ File too large (>1500MB)");
    }

    console.log("⬇️ Downloading:", file.name);


    const megaFol =  File.fromURL(file.url);
    const megaFile = await megaFol.loadAttributes();
    //const megaFile = file.node;
    const savePath = path.join(DOWNLOAD_DIR, file.name);
    const fileUrl = `${this_server}/download/${encodeURIComponent(file.name)}`;
    
    /* Crashed 👇 for bigger files */
    /*const data = await megaFile.downloadBuffer();
    console.log(data);
    fs.writeFileSync(savePath, data);

    res.send({
      message: "Downloaded",
      file: `/download/${file.name}`
    });
    
    //This download properly works only woth retying system 
    const stream = await megaFile.download();

    const writeStream = fs.createWriteStream(savePath);

    stream.pipe(writeStream);

    writeStream.on('finish', () => {
      console.log("✅ Download complete");
      res.send({
        message: "Downloaded",
        file: `/download/${file.name}`
      });
    });*/

    const stream = await megaFile.download();
    const writeStream = fs.createWriteStream(savePath);

    let downloaded = 0;
    let startTime = Date.now();

    downloadStatus = {
      status: "downloading",
      file: file.name,
      progress: 0,
      speed: "0 KB/s",
      done: false
    };

    stream.on('data', (chunk) => {
        downloaded += chunk.length;

        const percent = ((downloaded / file.size) * 100).toFixed(2);
        const elapsed = (Date.now() - startTime) / 1000;
        //const speed = (downloaded / 1024 / 1024 / elapsed).toFixed(2) + " MB/s";
        const speed = elapsed > 0 ? (downloaded / 1024 / 1024 / elapsed).toFixed(2) + " MB/s" : "0 MB/s";

        downloadStatus.progress = Number(percent);
        downloadStatus.speed = speed;
    });

    stream.pipe(writeStream);

    writeStream.on('finish', () => {
        downloadStatus.status = "finished";
        downloadStatus.progress = 100;
        downloadStatus.done = true;

        console.log("✅ Download complete");

        res.send({
           message: "Downloaded",
           file:  `/download/${file.name}`,
           url: fileUrl
        });
    });

  } catch (err) {
    console.error(err);
    res.send("❌ Download error");
  }
});

/* ---------------------------
   SERVE DOWNLOADED FILE
--------------------------- */
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(DOWNLOAD_DIR, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.send("❌ File not found");
  }

  res.download(filePath);
});

/* ---------------------------
   CLEAN DOWNLOADS
--------------------------- */
app.get('/clean', (req, res) => {
  fs.emptyDirSync(DOWNLOAD_DIR);
  res.send("🧹 Download folder cleaned");
});

/* ---------------------------
   START SERVER
--------------------------- */
app.listen(PORT,async () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
  startQueueWorker();
});
