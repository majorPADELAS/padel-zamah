// Padel Zamah: veza telefon (reket) ↔ računar (ekran na TV-u)
// Računar pravi kod i QR; telefon otvara ?r=KOD i šalje zamahe i ugao reketa preko WebRTC (PeerJS).
(() => {
  "use strict";
  const pz = window.__pz;
  if (!pz || !pz.api) return;
  const api = pz.api;
  const $ = id => document.getElementById(id);
  const PREFIX = "padelzamah-";
  const JOIN = new URLSearchParams(location.search).get("r");
  const HAS_PEER = typeof Peer !== "undefined";
  let conn = null, rtt = 60, pingTimer = 0;
  const send = m => { try { if (conn && conn.open) conn.send(m); } catch (e) {} };

  const css = document.createElement("style");
  css.textContent = [
    ".pair{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;",
    "  padding:20px;text-align:center;background:rgba(8,22,38,.9)}",
    ".pair h2{margin:0;font-family:var(--display);font-weight:800;font-size:1.6rem;text-transform:uppercase;letter-spacing:.04em}",
    ".pair .code{font-family:var(--display);font-weight:800;font-size:4.2rem;line-height:1;letter-spacing:.12em;color:var(--ball);font-variant-numeric:tabular-nums}",
    ".pair .qr{background:#fff;padding:10px;border-radius:6px;line-height:0}",
    ".pair .qr:empty{display:none}",
    ".pair .url{font-size:.9rem;color:var(--muted);word-break:break-all;max-width:36em}",
    ".pair .st{font-size:.95rem;color:var(--line);min-height:1.4em}",
    ".pair .st.warn{color:var(--ball)}",
    ".tvExit{z-index:4}",
    "body.ctrl .tabs,body.ctrl #trainerView,body.ctrl #matchView,body.ctrl #testBtn,body.ctrl #pairBtn,body.ctrl #tvBtn{display:none!important}",
    ".ctrlPanel{display:flex;flex-direction:column;gap:10px;padding:24px 16px;text-align:center;border:2px solid var(--line);border-radius:6px;background:var(--court-2)}",
    ".ctrlPanel .say{font-family:var(--display);font-weight:800;font-size:2.6rem;line-height:1.1;text-transform:uppercase;min-height:1.1em;color:var(--ball)}",
    ".ctrlPanel .say.bad{color:var(--danger)}",
    ".ctrlPanel .st{font-size:1rem;line-height:1.45}"
  ].join(String.fromCharCode(10));
  document.head.appendChild(css);

  if (JOIN) phone(); else screen();

  // ---------- Računar: ekran na TV-u ----------
  function screen() {
    const btn = document.createElement("button");
    btn.id = "pairBtn"; btn.className = "small"; btn.textContent = "Poveži telefon";
    $("startBtn").parentNode.appendChild(btn);

    const pair = document.createElement("div");
    pair.className = "pair"; pair.hidden = true;
    pair.innerHTML = '<h2>Skeniraj kamerom telefona</h2><div class="qr" id="pairQr"></div>' +
      '<div class="code" id="pairCode">····</div><div class="url" id="pairUrl"></div><div class="st" id="pairSt"></div>';
    $("stage").appendChild(pair);
    const st = (t, warn) => { $("pairSt").textContent = t; $("pairSt").classList.toggle("warn", !!warn); };

    let peer = null;
    btn.addEventListener("click", () => {
      api.audio();                                   // zvuk ide na TV, mora da krene od klika
      if (api.mode !== "match") api.setMode("match");
      api.tv(true);
      try { const r = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
      pair.hidden = false;
      if (!HAS_PEER) { st("Veza nije učitana. Proveri internet pa osveži stranicu.", true); return; }
      if (conn && conn.open) { pair.hidden = true; return; }
      if (!peer) makePeer();
    });

    function makePeer() {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      st("Pravim kod...");
      peer = new Peer(PREFIX + code, { debug: 0 });
      peer.on("open", () => {
        const url = location.origin + location.pathname + "?r=" + code;
        $("pairCode").textContent = code;
        $("pairUrl").textContent = url.replace("https://", "");
        $("pairQr").innerHTML = "";
        if (typeof QRCode !== "undefined") {
          try { new QRCode($("pairQr"), { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); } catch (e) {}
        }
        st("Čekam telefon. Telefon i računar mogu biti na bilo kojoj mreži, ali isti Wi-Fi radi najbrže.");
      });
      peer.on("error", e => {
        if (e.type === "unavailable-id") { peer.destroy(); peer = null; makePeer(); return; }
        st("Greška veze (" + e.type + "). Osveži stranicu i probaj ponovo.", true);
      });
      peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
      peer.on("connection", c => {
        if (conn && conn.open) { c.close(); return; }
        conn = c;
        c.on("open", () => {
          pair.hidden = true;
          api.msg("Telefon je povezan.");
          api.startRemote();
          clearInterval(pingTimer);
          pingTimer = setInterval(() => send({ t: "ping", c: performance.now() }), 1500);
          send({ t: "say", text: "Povezan", kind: "good" });
        });
        c.on("data", onScreenData);
        c.on("close", () => {
          conn = null; clearInterval(pingTimer);
          pair.hidden = false; st("Telefon se odvojio. Skeniraj ponovo.", true);
        });
      });
    }

    function onScreenData(d) {
      if (!d || !d.t) return;
      if (d.t === "q" && Array.isArray(d.q)) api.setRemoteQuat(d.q);
      else if (d.t === "sw") {
        // Vreme najbrže tačke zamaha, prevedeno u sat računara: koliko je davno bio vrh + pola puta mreže
        const tPeak = performance.now() - (+d.ago || 0) - rtt / 2;
        const face = Array.isArray(d.f) && typeof THREE !== "undefined" ? new THREE.Vector3().fromArray(d.f) : null;
        api.swing(Math.max(0, Math.min(1, +d.p || 0)), tPeak, face);
      } else if (d.t === "pong") {
        const r = performance.now() - d.c;
        if (r > 0 && r < 2000) rtt = rtt * 0.7 + r * 0.3;
      }
    }

    // Natpisi iz igre (Volej, Smeč, Aut...) idu i na telefon
    new MutationObserver(() => {
      const el = $("callout");
      if (el.textContent) send({ t: "say", text: el.textContent, kind: el.classList.contains("bad") ? "bad" : "good" });
    }).observe($("callout"), { childList: true, characterData: true, subtree: true });
  }

  // ---------- Telefon: reket ----------
  function phone() {
    document.body.classList.add("ctrl");
    document.querySelector("h1").textContent = "Padel Reket";
    const panel = document.createElement("div");
    panel.className = "ctrlPanel";
    panel.innerHTML = '<div class="say" id="say"></div><div class="st" id="ctrlSt">Povezujem se sa ekranom ' + JOIN + '...</div>';
    document.querySelector("header").after(panel);
    $("calBtn").hidden = false;
    api.msg("Pritisni Start, dozvoli pokret, pa drži telefon kao reket uperen ka TV-u.");
    const st = t => { $("ctrlSt").textContent = t; };
    let sayTimer = 0;
    const say = (t, kind) => {
      $("say").textContent = t; $("say").className = "say " + (kind || "");
      clearTimeout(sayTimer); sayTimer = setTimeout(() => { $("say").textContent = ""; }, 1500);
    };

    // Zamah ide na ekran; ugao reketa se šalje ~30 puta u sekundi
    api.setOnSwing((p, t, f) => {
      send({ t: "sw", p, ago: performance.now() - t, f: f && f.toArray ? f.toArray() : null });
    });
    setInterval(() => { const q = api.racketQuat(); if (q) send({ t: "q", q }); }, 33);

    if (!HAS_PEER) { st("Veza nije učitana. Proveri internet pa osveži stranicu."); return; }
    const peer = new Peer({ debug: 0 });
    peer.on("open", () => {
      conn = peer.connect(PREFIX + JOIN, { serialization: "json", reliable: true });
      conn.on("open", () => st("Povezan sa ekranom " + JOIN + ". Pritisni Start."));
      conn.on("data", d => {
        if (!d || !d.t) return;
        if (d.t === "ping") send({ t: "pong", c: d.c });
        else if (d.t === "say") say(d.text, d.kind);
      });
      conn.on("close", () => st("Veza sa ekranom je prekinuta. Skeniraj QR kod ponovo."));
    });
    peer.on("error", e => {
      st(e.type === "peer-unavailable"
        ? "Ekran sa kodom " + JOIN + " nije pronađen. Na računaru klikni Poveži telefon i skeniraj novi kod."
        : "Greška veze (" + e.type + "). Osveži stranicu.");
    });
  }
})();
