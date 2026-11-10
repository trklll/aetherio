const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on("pageerror", e => errs.push("PAGEERROR " + String(e).slice(0,300)));
  p.on("console", m => { if (m.type()==="error") errs.push("CONSOLE " + m.text().slice(0,300)); });
  await p.addInitScript(() => {
    const w = window; let nextId = 1;
    const STATUS = { timePos: 806, duration: 3646, pause: false, fileLoaded: true, sid: 2, aid: 1, speed: 1, videoWidth: 1920, videoHeight: 1080, tracks: [{id:1,type:"audio",title:"es",lang:"spa"}] };
    w.__TAURI_INTERNALS__ = {
      transformCallback(){ return nextId++; },
      async invoke(cmd){ if(cmd==="mpv_status") return {...STATUS, timePos: STATUS.timePos+1};
        if(cmd==="playback_capabilities") return {hardwareDecode:true, secondAudio:true};
        if(cmd.startsWith("plugin:event|")) return nextId++; return null; },
      convertFileSrc: (p)=>p,
      metadata: { currentWindow:{label:"main"}, currentWebview:{label:"main"} }, plugins: {},
    };
    w.__TAURI__ = { event: { listen: async () => () => undefined } };
    localStorage.setItem("aetherio-local-mode-v1","1");
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({name:"X",addonName:"T",url:"https://cdn.example/a.mkv",behaviorHints:{headers:{}}}));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({name:"X",resumeTime:806}));
  });
  await p.goto("http://127.0.0.1:1420/big-picture/player?type=movie&id=tmdb%3A4951", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  const info = await p.evaluate(() => ({
    glass: !!document.querySelector("[data-player-controls-glass]"),
    pause: !!document.querySelector("[data-player-pause-screen]"),
    rootText: (document.body.innerText || "").slice(0, 400),
  }));
  console.log(JSON.stringify(info, null, 2));
  console.log("ERRORES:", errs.slice(0, 6).join("\n") || "ninguno");
  await b.close();
})();
