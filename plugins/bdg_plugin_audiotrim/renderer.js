/// <reference path="../plugin-api.d.ts" />
/**
 * Audio Trim plugin.
 *
 * Visualizes a crop span on the timeline (drag either handle), then either
 * exports a trimmed WAV copy or crops in place and shifts the timeline so the
 * existing beat markers stay locked to the retained audio.
 */
window.__bdgPluginRegister(function activate(api) {
  var MIN_SPAN_MS = 20;
  var SNAP_PX = 8;

  var LANG = (document.documentElement.lang || navigator.language || "").toLowerCase();
  var ZH = LANG.indexOf("zh") === 0;
  function L(zh, en) {
    return ZH ? zh : en;
  }

  var state = { startMs: 0, endMs: 0, ready: false, lastDuration: -1 };
  var selectionOn = api.storage.get("selectionOn", true) === true;
  // Beat-grid subdivision for handle snapping; 1 = integer beats, 0 = free.
  var SNAP_CHOICES = [0, 1, 2, 4, 8];
  var snapDiv = api.storage.get("snapDiv", 1);
  if (SNAP_CHOICES.indexOf(snapDiv) < 0) snapDiv = 1;
  var subs = [];
  var disposers = [];
  var containerEl = null;
  var overlayParts = null;
  var statusText = "";
  var statusElDom = null;

  function log() {
    api.log.apply(api, arguments);
  }

  function setStatus(msg) {
    statusText = msg;
    if (statusElDom) statusElDom.textContent = msg;
  }

  var styleEl = document.createElement("style");
  styleEl.textContent = [
    ".bdg-trim-shade{position:absolute;top:0;bottom:0;background:rgba(0,0,0,.35);pointer-events:none}",
    ".bdg-trim-region{position:absolute;top:0;bottom:0;box-sizing:border-box;",
    "border-left:2px solid var(--bdg-accent,#4ea1ff);border-right:2px solid var(--bdg-accent,#4ea1ff);",
    "background:rgba(78,161,255,.12);pointer-events:none}",
    ".bdg-trim-handle{position:absolute;top:0;bottom:0;width:14px;margin-left:-7px;cursor:ew-resize;",
    "pointer-events:auto;touch-action:none}",
    ".bdg-trim-handle::after{content:'';position:absolute;top:50%;left:50%;width:4px;height:34px;",
    "transform:translate(-50%,-50%);background:var(--bdg-accent,#4ea1ff);border-radius:2px;",
    "box-shadow:0 0 0 1px rgba(0,0,0,.35)}",
    ".bdg-trim-pane{padding:10px 12px;display:flex;flex-direction:column;gap:8px}",
    ".bdg-trim-row{display:flex;align-items:center;gap:6px}",
    ".bdg-trim-row>label{width:52px;flex:none;color:var(--bdg-text-dim,#9aa);font-size:12px}",
    ".bdg-trim-row>input,.bdg-trim-row>select{flex:1;min-width:0;background:var(--bdg-bg-sunken,#1a1d22);",
    "border:1px solid var(--bdg-border,#333);border-radius:6px;color:var(--bdg-text,#eee);",
    "font:inherit;font-size:12px;padding:3px 6px;outline:none}",
    ".bdg-trim-mini{flex:none;background:none;border:1px solid var(--bdg-border,#333);",
    "color:var(--bdg-text-dim,#9aa);border-radius:6px;cursor:pointer;font-size:11px;padding:3px 7px}",
    ".bdg-trim-mini:hover{color:var(--bdg-text,#eee)}",
    ".bdg-trim-info{font-size:12px;color:var(--bdg-text-dim,#9aa);line-height:1.5}",
    ".bdg-trim-btn{background:var(--bdg-accent,#4ea1ff);border:none;border-radius:6px;color:#06121f;",
    "cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:6px 8px}",
    ".bdg-trim-btn.ghost{background:transparent;border:1px solid var(--bdg-border-strong,#555);",
    "color:var(--bdg-text,#eee);font-weight:400}",
    ".bdg-trim-btn:disabled{opacity:.5;cursor:default}",
    ".bdg-trim-warn{font-size:11px;color:var(--bdg-amber,#e8a53c);line-height:1.45}",
    ".bdg-trim-status{font-size:11px;color:var(--bdg-accent,#4ea1ff);min-height:14px;word-break:break-all}",
  ].join("");
  document.head.appendChild(styleEl);

  function notify() {
    // Repaint the overlay first so a range change (drag or typing) is visible
    // immediately, then refresh any subscribed panel UI.
    renderOverlay();
    for (var i = 0; i < subs.length; i++) {
      try {
        subs[i]();
      } catch (err) {
        log("subscriber error", err);
      }
    }
  }

  function durationMs() {
    return api.timeline.durationMs() || 0;
  }

  function clampMs(ms) {
    var d = durationMs();
    if (!isFinite(ms) || ms < 0) ms = 0;
    if (d > 0 && ms > d) ms = d;
    return ms;
  }

  function setRange(start, end) {
    var d = durationMs();
    start = clampMs(start);
    end = clampMs(end);
    if (end - start < MIN_SPAN_MS) {
      if (start + MIN_SPAN_MS <= d) end = start + MIN_SPAN_MS;
      else start = Math.max(0, end - MIN_SPAN_MS);
    }
    state.startMs = start;
    state.endMs = end;
    state.ready = true;
    notify();
  }

  function ensureInitial() {
    var d = durationMs();
    if (d <= 0) {
      state.ready = false;
      return;
    }
    if (!state.ready || state.lastDuration !== d) {
      state.lastDuration = d;
      state.startMs = 0;
      state.endMs = d;
      state.ready = true;
    }
  }

  function fmt(ms) {
    ms = Math.max(0, Math.floor(ms));
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    var msec = ms % 1000;
    function pad(n, w) {
      var str = String(n);
      while (str.length < w) str = "0" + str;
      return str;
    }
    return pad(m, 2) + ":" + pad(s, 2) + "." + pad(msec, 3);
  }

  /**
   * Snap a time to the beat grid. `snapDiv` is the subdivision: 1 = integer
   * beats (default), 2 = half beats, 0 = no snapping. When snapping is on we
   * also pull to a marker within SNAP_PX so cut points land exactly on a
   * (possibly off-grid) beat marker.
   */
  function snapMs(ms) {
    ms = clampMs(ms);
    if (snapDiv > 0) {
      var beat = api.project.beatOfTime(ms);
      ms = api.project.timeOfBeat(Math.round(beat * snapDiv) / snapDiv);
    }
    var vp = api.timeline.viewport();
    if (vp.pxPerSec) {
      var threshold = (SNAP_PX / vp.pxPerSec) * 1000;
      var snap = api.project.snapshot();
      var best = ms;
      var bestD = threshold;
      for (var i = 0; i < snap.markers.length; i++) {
        var d = Math.abs(snap.markers[i].timeMs - ms);
        if (d <= bestD) {
          bestD = d;
          best = snap.markers[i].timeMs;
        }
      }
      ms = best;
    }
    return clampMs(ms);
  }

  function countOutside(start, end) {
    var snap = api.project.snapshot();
    var n = 0;
    for (var i = 0; i < snap.markers.length; i++) {
      var t = snap.markers[i].timeMs;
      if (t < start - 0.5 || t > end + 0.5) n++;
    }
    return n;
  }

  // ---- timeline overlay ----

  function buildOverlay(host) {
    containerEl = host;
    var shadeL = document.createElement("div");
    shadeL.className = "bdg-trim-shade";
    var shadeR = document.createElement("div");
    shadeR.className = "bdg-trim-shade";
    var region = document.createElement("div");
    region.className = "bdg-trim-region";
    var hs = document.createElement("div");
    hs.className = "bdg-trim-handle";
    var he = document.createElement("div");
    he.className = "bdg-trim-handle";
    host.appendChild(shadeL);
    host.appendChild(shadeR);
    host.appendChild(region);
    host.appendChild(hs);
    host.appendChild(he);
    overlayParts = { shadeL: shadeL, shadeR: shadeR, region: region, hs: hs, he: he };

    function beginDrag(which, ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      var handle = which === "start" ? hs : he;
      try {
        handle.setPointerCapture(ev.pointerId);
      } catch (e) {
        /* ignore */
      }
      function move(e2) {
        e2.preventDefault();
        e2.stopPropagation();
        var rect = containerEl.getBoundingClientRect();
        var ms = snapMs(api.timeline.screenToTime(e2.clientX - rect.left));
        if (which === "start") setRange(Math.min(ms, state.endMs - MIN_SPAN_MS), state.endMs);
        else setRange(state.startMs, Math.max(ms, state.startMs + MIN_SPAN_MS));
      }
      function up(e2) {
        e2.stopPropagation();
        try {
          handle.releasePointerCapture(ev.pointerId);
        } catch (e) {
          /* ignore */
        }
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    }

    hs.addEventListener("pointerdown", function (e) {
      beginDrag("start", e);
    });
    he.addEventListener("pointerdown", function (e) {
      beginDrag("end", e);
    });

    return function cleanup() {
      overlayParts = null;
      containerEl = null;
      host.textContent = "";
    };
  }

  function renderOverlay() {
    if (!overlayParts) return;
    ensureInitial();
    containerEl.style.display = selectionOn ? "" : "none";
    if (!selectionOn) return;
    var vp = api.timeline.viewport();
    var W = vp.vw || 0;
    var sx = Math.max(0, Math.min(W, api.timeline.timeToScreenX(state.startMs)));
    var ex = Math.max(0, Math.min(W, api.timeline.timeToScreenX(state.endMs)));
    var P = overlayParts;
    P.shadeL.style.left = "0px";
    P.shadeL.style.width = sx + "px";
    P.shadeR.style.left = ex + "px";
    P.shadeR.style.width = Math.max(0, W - ex) + "px";
    P.region.style.left = sx + "px";
    P.region.style.width = Math.max(0, ex - sx) + "px";
    P.hs.style.left = sx + "px";
    P.he.style.left = ex + "px";
  }

  disposers.push(
    api.ui.registerTimelineOverlay({ id: "trim-range", z: 5, mount: buildOverlay }),
  );

  // ---- crop actions ----

  function audioBaseName() {
    var p = api.system.audioPath();
    var name = p ? p.replace(/\\/g, "/").split("/").pop() : "audio";
    return (name || "audio").replace(/\.[^.]+$/, "");
  }

  function defaultSavePath() {
    var p = api.system.audioPath();
    var dir = p ? p.replace(/\\/g, "/").replace(/\/[^/]*$/, "") : "";
    return (dir ? dir + "/" : "") + audioBaseName() + "_trim.wav";
  }

  function saveWav(bytes, onSaved) {
    api.system
      .saveFile({
        title: L("另存裁剪音频", "Save trimmed audio"),
        defaultPath: defaultSavePath(),
        filters: [{ name: "WAV", extensions: ["wav"] }],
      })
      .then(function (res) {
        if (res.canceled || !res.filePath) return null;
        return api.system.writeBytes(res.filePath, bytes).then(function (ok) {
          if (!ok) throw new Error("write failed");
          if (onSaved) onSaved(res.filePath);
          return res.filePath;
        });
      })
      .catch(function (err) {
        setStatus("错误: " + err);
        log("save failed", err);
      });
  }

  function guardRange() {
    if (!state.ready || durationMs() <= 0) {
      setStatus(L("请先加载音频", "Load an audio file first"));
      return false;
    }
    if (state.endMs - state.startMs < MIN_SPAN_MS) {
      setStatus(L("选区过短", "Selection is too short"));
      return false;
    }
    return true;
  }

  function doExport() {
    if (!guardRange()) return;
    var buf = api.audio.getBuffer();
    if (!buf) {
      setStatus(L("无可裁剪音频", "No audio to trim"));
      return;
    }
    setStatus(L("编码中…", "Encoding…"));
    try {
      var bytes = api.audio.encodeWav(buf, state.startMs, state.endMs);
      saveWav(bytes, function (path) {
        setStatus(L("已导出: ", "Exported: ") + path);
      });
    } catch (err) {
      setStatus("错误: " + err);
      log("encode failed", err);
    }
  }

  function doCropReplace() {
    if (!guardRange()) return;
    var buf = api.audio.getBuffer();
    if (!buf) {
      setStatus(L("无可裁剪音频", "No audio to trim"));
      return;
    }
    var start = state.startMs;
    var end = state.endMs;
    setStatus(L("编码中…", "Encoding…"));
    var bytes;
    try {
      bytes = api.audio.encodeWav(buf, start, end);
    } catch (err) {
      setStatus("错误: " + err);
      return;
    }
    // Snapshot the removals and offset BEFORE the audio swap (timeMs reflects
    // the current tempo map); the batch then applies as one undo step.
    var snap = api.project.snapshot();
    var offset = snap.offsetMs;
    var remove = [];
    for (var i = 0; i < snap.markers.length; i++) {
      var t = snap.markers[i].timeMs;
      if (t < start - 0.5 || t > end + 0.5) remove.push(snap.markers[i].id);
    }
    saveWav(bytes, function (path) {
      setStatus(L("替换音频中…", "Replacing audio…"));
      api.audio
        .replaceFromBytes(bytes, { filePath: path, autoApply: false })
        .then(function (ok) {
          if (!ok) throw new Error("replace failed");
          api.project.edit.batch(function () {
            for (var k = 0; k < remove.length; k++) {
              api.project.edit.removeMarker(remove[k]);
            }
            // Beat markers keep their beat numbers; shifting the offset by
            // -start locks them to the same content in the cropped audio.
            api.project.edit.setOffset(offset - start);
          });
          state.ready = false;
          state.lastDuration = -1;
          ensureInitial();
          notify();
          setStatus(
            L(
              "已裁剪并替换（撤销仅恢复偏移与踩点，音频需手动回退）",
              "Cropped and replaced (undo restores offset/markers only; audio is manual)",
            ),
          );
        })
        .catch(function (err) {
          setStatus("错误: " + err);
          log("replace failed", err);
        });
    });
  }

  // ---- panel ----

  var panel = api.ui.registerPanel({
    id: "trim",
    title: { zh: "音频裁剪", en: "Audio Trim" },
    defaultWidth: 380,
    defaultHeight: 330,
    minWidth: 300,
    minHeight: 260,
    mount: function mount(host) {
      host.textContent = "";
      var pane = document.createElement("div");
      pane.className = "bdg-trim-pane";
      host.appendChild(pane);

      function makeRow(label, input, extraBtn) {
        var r = document.createElement("div");
        r.className = "bdg-trim-row";
        var l = document.createElement("label");
        l.textContent = label;
        r.appendChild(l);
        r.appendChild(input);
        if (extraBtn) r.appendChild(extraBtn);
        pane.appendChild(r);
      }

      var startInput = document.createElement("input");
      startInput.type = "number";
      startInput.step = "0.001";
      startInput.min = "0";
      var btnStartHere = document.createElement("button");
      btnStartHere.className = "bdg-trim-mini";
      btnStartHere.textContent = "⌖";
      btnStartHere.title = L("用播放头设为起点", "Set start at playhead");
      makeRow(L("起点", "Start"), startInput, btnStartHere);

      var endInput = document.createElement("input");
      endInput.type = "number";
      endInput.step = "0.001";
      endInput.min = "0";
      var btnEndHere = document.createElement("button");
      btnEndHere.className = "bdg-trim-mini";
      btnEndHere.textContent = "⌖";
      btnEndHere.title = L("用播放头设为终点", "Set end at playhead");
      makeRow(L("终点", "End"), endInput, btnEndHere);

      var snapSelect = document.createElement("select");
      [
        { v: 1, zh: "整数拍（1 拍）", en: "Whole beats (1)" },
        { v: 2, zh: "1/2 拍", en: "1/2 beat" },
        { v: 4, zh: "1/4 拍", en: "1/4 beat" },
        { v: 8, zh: "1/8 拍", en: "1/8 beat" },
        { v: 0, zh: "不对齐", en: "No snap" },
      ].forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = String(o.v);
        opt.textContent = ZH ? o.zh : o.en;
        snapSelect.appendChild(opt);
      });
      snapSelect.value = String(snapDiv);
      snapSelect.addEventListener("change", function () {
        snapDiv = Number(snapSelect.value) || 0;
        api.storage.set("snapDiv", snapDiv);
        setRange(snapMs(state.startMs), snapMs(state.endMs));
      });
      makeRow(L("对齐", "Snap"), snapSelect);

      var info = document.createElement("div");
      info.className = "bdg-trim-info";
      pane.appendChild(info);

      var btnExport = document.createElement("button");
      btnExport.className = "bdg-trim-btn ghost";
      btnExport.textContent = L("导出裁剪副本 (WAV)", "Export trimmed copy (WAV)");
      pane.appendChild(btnExport);

      var btnCrop = document.createElement("button");
      btnCrop.className = "bdg-trim-btn";
      btnCrop.textContent = L("裁剪并替换当前音频", "Crop & replace current audio");
      pane.appendChild(btnCrop);

      var warn = document.createElement("div");
      warn.className = "bdg-trim-warn";
      warn.textContent = L(
        "提示：替换音频不进入撤销栈，撤销只能恢复偏移与踩点。",
        "Note: replacing audio is not undoable; undo restores offset and markers only.",
      );
      pane.appendChild(warn);

      var statusEl = document.createElement("div");
      statusEl.className = "bdg-trim-status";
      pane.appendChild(statusEl);
      statusElDom = statusEl;
      statusEl.textContent = statusText;

      var syncing = false;
      function refresh() {
        if (syncing) return;
        ensureInitial();
        syncing = true;
        if (document.activeElement !== startInput) {
          startInput.value = (state.startMs / 1000).toFixed(3);
        }
        if (document.activeElement !== endInput) {
          endInput.value = (state.endMs / 1000).toFixed(3);
        }
        syncing = false;
        var span = state.endMs - state.startMs;
        var outside = countOutside(state.startMs, state.endMs);
        var dur = durationMs();
        info.textContent =
          L("选区 ", "Span ") +
          fmt(span) +
          L(" / 总长 ", " / total ") +
          fmt(dur) +
          L(" · 裁掉 ", " · cuts ") +
          outside +
          L(" 个踩点", " markers");
        var hasAudio = dur > 0;
        btnExport.disabled = !hasAudio;
        btnCrop.disabled = !hasAudio;
      }

      startInput.addEventListener("input", function () {
        var v = parseFloat(startInput.value);
        if (isFinite(v)) setRange(v * 1000, state.endMs);
      });
      endInput.addEventListener("input", function () {
        var v = parseFloat(endInput.value);
        if (isFinite(v)) setRange(state.startMs, v * 1000);
      });
      btnStartHere.addEventListener("click", function () {
        setRange(api.player.positionMs(), state.endMs);
      });
      btnEndHere.addEventListener("click", function () {
        setRange(state.startMs, api.player.positionMs());
      });
      btnExport.addEventListener("click", doExport);
      btnCrop.addEventListener("click", doCropReplace);

      subs.push(refresh);
      refresh();

      return function unmount() {
        var i = subs.indexOf(refresh);
        if (i >= 0) subs.splice(i, 1);
        statusElDom = null;
        host.textContent = "";
      };
    },
  });

  // ---- events / contributions ----

  var barHandle = api.ui.registerBarButton({
    id: "toggle-selection",
    title: { zh: "裁剪选区", en: "Trim selection" },
    icon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/>' +
      '<path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
    toggle: true,
    active: selectionOn,
    order: 100,
    run: function (active) {
      selectionOn = active;
      api.storage.set("selectionOn", active);
      renderOverlay();
    },
  });

  disposers.push(
    api.events.on("view", renderOverlay),
    api.events.on("project", function () {
      ensureInitial();
      notify();
    }),
    api.ui.registerShortcut({
      id: "toggle-trim",
      label: { zh: "音频裁剪…", en: "Audio trim…" },
      combo: "Alt+T",
      run: function () {
        panel.toggle();
      },
    }),
    barHandle.dispose,
  );

  renderOverlay();

  return function dispose() {
    for (var i = 0; i < disposers.length; i++) {
      try {
        disposers[i]();
      } catch (err) {
        log("dispose error", err);
      }
    }
    disposers.length = 0;
    subs.length = 0;
    statusElDom = null;
    if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    log("audio trim disposed");
  };
});
