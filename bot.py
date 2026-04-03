import os
import asyncio
import subprocess
from pyrogram import Client

API_ID = int(os.getenv("API_ID"))
API_HASH = os.getenv("API_HASH")
BOT_TOKEN = os.getenv("BOT_TOKEN")
CHAT_ID = int(os.getenv("CHAT_ID"))

DOWNLOAD_DIR = "./downloads"

app = Client("uploader_bot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)

processed = set()

import json

STATUS_FILE = "upload-status.json"

def update_status(data):
    with open(STATUS_FILE, "w") as f:
        json.dump(data, f, indent=2)

def get_duration(file_path):
    try:
        output = subprocess.check_output([
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path
        ]).decode().strip()

        return int(float(output))
    except:
        return 0

async def upload(file_path):
    name = os.path.basename(file_path)

    try:
        update_status({
            "status": "uploading",
            "file": name,
            "progress": 0,
            "done": False
        })

        print(f"📤 Uploading: {name}")

        async def progress(current, total):
            percent = int(current * 100 / total)

            update_status({
                "status": "uploading",
                "file": name,
                "progress": percent,
                "done": False
            })

        if name.lower().endswith((".mp4", ".mkv", ".avi", ".mov", ".webm")):
            duration = get_duration(file_path)

            await app.send_video(
                CHAT_ID,
                video=file_path,
                caption=name,
                duration=duration,
                supports_streaming=True,
                progress=progress
            )
        else:
            await app.send_document(
                CHAT_ID,
                document=file_path,
                caption=name,
                progress=progress
            )

        update_status({
            "status": "finished",
            "file": name,
            "progress": 100,
            "done": True
        })

        print(f"✅ Uploaded: {name}")

        os.remove(file_path)

    except Exception as e:
        update_status({
            "status": "error",
            "file": name,
            "progress": 0,
            "done": False
        })

        print("❌ Upload error:", e)

async def upload_(file_path):
    name = os.path.basename(file_path)

    try:
        print(f"📤 Uploading: {name}")

        if name.lower().endswith((".mp4", ".mkv", ".avi", ".mov", ".webm")):
            duration = get_duration(file_path)

            await app.send_video(
                CHAT_ID,
                video=file_path,
                caption=name,
                duration=duration,
                supports_streaming=True
            )
        else:
            await app.send_document(
                CHAT_ID,
                document=file_path,
                caption=name
            )

        print(f"✅ Uploaded: {name}")

        os.remove(file_path)
        print(f"🗑 Deleted: {name}")

    except Exception as e:
        print("❌ Upload error:", e)

async def watcher():
    print("👀 Watching folder...")

    while True:
        try:
            files = os.listdir(DOWNLOAD_DIR)

            for f in files:
                path = os.path.join(DOWNLOAD_DIR, f)

                if path not in processed and os.path.isfile(path):
                    processed.add(path)
                    await upload(path)

        except Exception as e:
            print("Watcher error:", e)

        await asyncio.sleep(5)

async def main():
    async with app:
        await watcher()

if __name__ == "__main__":
    asyncio.run(main())
