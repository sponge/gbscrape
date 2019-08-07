const he = require('he');
const CronJob = require('cron').CronJob;
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const { URLSearchParams } = require('url');
const fetch = require('fetch-cookie/node-fetch')(require('node-fetch'));
const { username, password, webhook } = require('./config.js');

const quality = {
  'adaptive_stream': 'Auto',
  'adaptive_high': 'HD',
  'adaptive_low': 'SD'
};

let lastVideo = {name: undefined};

async function doPostWebhook(videoInfo) {
  const params = {
    username: "Giant Bomb Live",
    avatar_url: 'https://i.imgur.com/Wej16H5.png',
    embeds: [{
      title: videoInfo.name,
      description: videoInfo.description,
      url: videoInfo.live,
    }]
  };

  params.embeds[0].description += '\n\n';
  for (let prop in videoInfo.streams) {
    params.embeds[0].description += `**${quality[prop] || prop}**: ${videoInfo.streams[prop]}\n`
  }

  const opts = { 
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params),
  };

  const response = await fetch(webhook, opts);

  //console.log(response);
}

async function doLogin(username, password) {
  const loginPageResponse = await fetch('https://www.giantbomb.com/login-signup/');
  const loginPageDom = new JSDOM(await loginPageResponse.text());
  //const token = loginPageDom.window.document.querySelector('#form__token').getAttribute('value');
  const token = loginPageDom.window.document.querySelector('input[name="form[_csrf_token]"').getAttribute('value')

  const params = new URLSearchParams();
  params.append('form[_username]', username);
  params.append('form[_password]', password);
  //params.append('form[_token]', token);
  params.append('form[_csrf_token]', token);
   
  const response = await fetch('https://www.giantbomb.com/check-login/', { method: 'POST', body: params });
  const text = await response.text();

  console.log('logged in');
}

async function checkLive() {
  try {
    const chat = 'https://www.giantbomb.com/chat/';
    const chatresp = await fetch(chat);
    const chattext = await chatresp.text();
    const chatdom = new JSDOM(chattext);

    const livestreamurl = chatdom.window.document.querySelector('#player-iframe');

    if (!livestreamurl) {
      console.log('Stream not online, player-iframe not found');
      return;
    }

    const url = `https://www.giantbomb.com${livestreamurl.getAttribute('src')}`;
    const response = await fetch(url);
    
    if (response.status != 200) {
      console.log('Stream not online.');
      return;
    }

    const streamText = await response.text();
    const dom = new JSDOM(streamText);
    const iframePlayer = dom.window.document.querySelector('#js-iframe-player-1');

    if (iframePlayer === null) {
      throw new Error("Couldn't find #js-iframe-player-1, aborting");
    }

    const embedUrl = `https://www.giantbomb.com${iframePlayer.getAttribute('src')}`;
    //const embedUrl = 'https://www.giantbomb.com/videos/embed/8635/?allow_gb=yes&ad_campaign_id=8635&autoplay=1';
    const embedResponse = await fetch(embedUrl);

    if (embedResponse.status != 200) {
      throw new Error(`Failed to fetch embed iframe ${embedUrl}.`);
    }

    const embedText = await embedResponse.text();
    const embedDom = new JSDOM(embedText);

    const video = embedDom.window.document.querySelector('.js-video-player-new');

    if (video === null) {
      throw new Error("Couldn't find .js-video-player-new inside the embed.");
    }

    const attr = video.getAttribute('data-video');
    const decoded = he.decode(attr);
    const videoInfo = JSON.parse(decoded);

    const streamInfo = {
      name: embedDom.window.document.querySelector('title').textContent,
      description: embedDom.window.document.querySelector('meta[name="description"]').getAttribute('content'),
      live: embedUrl,
      streams: videoInfo.videoStreams
    }

    if (streamInfo.name === lastVideo.name) {
      return;
    }

    console.log(streamInfo)

    await doPostWebhook(streamInfo);
    lastVideo = streamInfo;
  } catch (error) {
    console.error(error);
  }
}

async function main() {
  await doLogin(username, password);
  new CronJob({
    cronTime: '*/10 * * * *',
    onTick: checkLive,
    start: true,
    runOnInit: true
  });
}

main();
