window.__bdgPluginRegister(function activate(api) {
  api.log("renderer entry activated (id=" + api.id + ")");

  var tr = api.trackTypes.register({
    id: "flip",
    trackName: { zh: "翻转轨", en: "Flip track" },
    pointName: { zh: "翻转点", en: "Flip" },
    color: "#e11d48",
    fields: [
      {
        key: "direction",
        label: { zh: "方向", en: "Direction" },
        type: "enum",
        default: "up",
        options: [
          { value: "up", label: { zh: "上", en: "Up" } },
          { value: "down", label: { zh: "下", en: "Down" } },
        ],
      },
      {
        key: "power",
        label: { zh: "力度", en: "Power" },
        type: "number",
        default: 1,
        min: 0,
        max: 10,
        step: 0.5,
      },
      {
        key: "hold",
        label: { zh: "长按", en: "Hold" },
        type: "bool",
        default: false,
      },
    ],
  });
  api.log("track type register:", tr);

  var stopEvents = [];

  function clearStopEvents() {
    for (var i = 0; i < stopEvents.length; i++) stopEvents[i]();
    stopEvents.length = 0;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  var panel = api.ui.registerPanel({
    id: "demo",
    title: { zh: "示例面板", en: "Demo Panel" },
    mount: function mount(host) {
      host.textContent = "";

      var wrap = el("div", "demo-wrap");
      host.appendChild(wrap);

      var head = el("div", "demo-head");
      head.textContent = api.id + " v" + api.version;
      wrap.appendChild(head);

      var stats = el("div", "demo-row");
      wrap.appendChild(stats);

      var log = el("pre", "demo-log");
      wrap.appendChild(log);

      function renderStats() {
        var s = api.project.snapshot();
        var pos = api.player.positionMs();
        stats.textContent =
          "tracks=" + s.tracks.length +
          " markers=" + s.markers.length +
          " bpm=" + s.baseBpm.toFixed(1) +
          " t=" + pos.toFixed(0) + "ms";
      }

      function logText(msg) {
        log.textContent = msg + "\n" + log.textContent;
      }

      stopEvents.push(api.events.on("project", renderStats));
      stopEvents.push(api.events.on("playhead", renderStats));

      var btnAdd = el("button", "demo-btn", "add marker @ playhead");
      btnAdd.addEventListener("click", function () {
        var beat = api.project.beatOfTime(api.player.positionMs());
        var s = api.project.snapshot();
        var trackId = s.tracks.length ? s.tracks[0].id : "";
        if (!trackId) return;
        var id = api.project.edit.addMarker({ trackId: trackId, beat: beat });
        logText("added marker " + id);
      });
      wrap.appendChild(btnAdd);

      var btnPing = el("button", "demo-btn", "ping main.js");
      btnPing.addEventListener("click", function () {
        api.callMain("ping", 1, 2)
          .then(function (res) {
            logText("main says: " + res);
          })
          .catch(function (err) {
            logText("main error: " + err);
          });
      });
      wrap.appendChild(btnPing);

      var btnExport = el("button", "demo-btn", "export tracks to txt");
      btnExport.addEventListener("click", function () {
        var s = api.project.snapshot();
        var lines = s.markers.map(function (m) {
          return m.timeMs.toFixed(3) + " (beat " + m.beat + ")";
        });
        api.system
          .saveFile({
            title: "Save sample export",
            defaultPath: "tracks.txt",
            filters: [{ name: "Text", extensions: ["txt"] }],
          })
          .then(function (res) {
            if (res.canceled || !res.filePath) return;
            return api.system.writeText(res.filePath, lines.join("\n"));
          })
          .then(function (ok) {
            logText(ok ? "saved" : "write failed");
          });
      });
      wrap.appendChild(btnExport);

      renderStats();
      logText("panel mounted");
      return function unmount() {
        clearStopEvents();
        host.textContent = "";
      };
    },
  });

  api.ui.registerAction({
    label: { zh: "切换示例面板", en: "Toggle demo panel" },
    run: function () {
      panel.toggle();
    },
  });

  api.ui.registerShortcut({
    id: "toggle-demo",
    label: { zh: "切换示例面板", en: "Toggle demo panel" },
    combo: "Alt+1",
    run: function () {
      panel.toggle();
    },
  });

  api.log("contributions registered");

  return function dispose() {
    clearStopEvents();
    api.log("renderer entry disposed");
  };
});
