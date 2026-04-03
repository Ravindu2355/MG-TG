FROM node:18

RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg

WORKDIR /app

COPY package.json .
RUN npm install

COPY requirements.txt .
RUN pip3 install -r requirements.txt

COPY . .

RUN mkdir -p downloads

CMD sh -c "node server.js & python3 bot.py"
