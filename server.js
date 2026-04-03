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
const PORT = 3000;

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
  console.log(node);
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

    const maxSize = 1500 * 1024 * 1024; // 1500MB

    if (file.size > maxSize) {
      return res.send("❌ File too large (>1500MB)");
    }

    console.log("⬇️ Downloading:", file.name);


    const megaFol =  File.fromURL(file.url);
    const megaFile = await megaFol.loadAttributes();
    //const megaFile = file.node;
    const savePath = path.join(DOWNLOAD_DIR, file.name);
    
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
        const speed = (downloaded / 1024 / 1024 / elapsed).toFixed(2) + " MB/s";

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
           file:  `/download/${file.name}`
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
app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
});
