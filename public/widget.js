/*
 * Embeddable chat widget. Add to any website:
 *   <script src="https://YOUR-CHATBOT-HOST/widget.js" data-bot="BOT_ID" async></script>
 * Optional attributes: data-api (override server URL), data-accent (override colour).
 * Self-contained: lives in a shadow root so it can't clash with the host page's CSS and
 * builds DOM with textContent only (no innerHTML). Visitors first give their name and
 * email; the conversation then survives page reloads and navigation within the browser
 * tab (kept in sessionStorage, cleared when the tab closes).
 */
(function () {
  var script = document.currentScript;
  if (!script || !script.dataset.bot) return console.error("[chatbot] missing data-bot attribute");
  var botId = script.dataset.bot;
  var api = (script.dataset.api || new URL(script.src).origin).replace(/\/+$/, "");
  var base = api + "/v1/web/" + encodeURIComponent(botId);

  fetch(base + "/config")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("config " + r.status)); })
    .then(function (cfg) { mount(cfg); })
    .catch(function (e) { console.error("[chatbot] could not start:", e.message); });

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "class") node.className = props[k];
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), props[k]);
      else node.setAttribute(k, props[k]);
    });
    [].concat(children || []).forEach(function (c) { node.append(c); });
    return node;
  }

  function mount(cfg) {
    var accent = script.dataset.accent || cfg.accentColor || "#2563eb";
    var host = el("div");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483000;bottom:0;right:0;";
    var root = host.attachShadow({ mode: "open" });
    root.append(el("style", {}, css(accent)));

    // session = { id, messages: [{role, text}], open } once the visitor has registered.
    var KEY = "chatbot:" + botId;
    var session = loadSession();
    var busy = false;
    var starting = false;

    function loadSession() {
      try {
        var s = JSON.parse(sessionStorage.getItem(KEY));
        return s && s.id && Array.isArray(s.messages) ? s : null;
      } catch (e) { return null; }
    }
    function saveSession() {
      try {
        if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
        else sessionStorage.removeItem(KEY);
      } catch (e) { /* storage blocked: the chat still works, it just won't survive a reload */ }
    }

    // ---- registration form -------------------------------------------------
    var fields = {
      name: el("input", { type: "text", name: "name", required: "", maxlength: "100", autocomplete: "name" }),
      email: el("input", { type: "email", name: "email", required: "", maxlength: "254", autocomplete: "email" }),
      phone: el("input", { type: "tel", name: "phone", maxlength: "30", autocomplete: "tel" }),
      description: el("textarea", { name: "description", rows: "3", maxlength: "500", placeholder: "What would you like help with?" }),
    };
    function field(label, input) { return el("label", {}, [label, input]); }
    var signupError = el("p", { class: "err", role: "alert" });
    var signupBtn = el("button", { type: "submit", class: "send" }, "Start chat");
    var signupNote = el("p", { class: "note" }, "We keep a record of this conversation and your details so our team can follow up. Please don't share passwords or sensitive data.");
    if (cfg.privacyUrl) signupNote.append(" ", el("a", { href: cfg.privacyUrl, target: "_blank", rel: "noopener" }, "Privacy policy"));
    var signup = el("form", { class: "signup", onsubmit: submitSignup }, [
      el("h3", {}, "Before we start"),
      el("p", {}, "Tell us who you are so we can follow up if needed."),
      field("Name *", fields.name),
      field("Email *", fields.email),
      field("Phone (optional)", fields.phone),
      field("Description (optional)", fields.description),
      signupError,
      signupBtn,
      signupNote,
    ]);

    // ---- chat view ----------------------------------------------------------
    var log = el("div", { class: "log", role: "log", "aria-live": "polite" });
    var input = el("input", { type: "text", maxlength: "1000", placeholder: "Type your question…", "aria-label": "Your message" });
    var send = el("button", { type: "submit", class: "send" }, "Send");
    var form = el("form", { class: "form", onsubmit: function (e) { e.preventDefault(); ask(input.value); } }, [
      el("div", { class: "row" }, [input, send]),
      el("p", { class: "note" }, "AI assistant - answers may be inaccurate."),
    ]);

    var panel = el("div", { class: "panel", role: "dialog", "aria-label": cfg.name + " assistant", hidden: "" }, [
      el("header", {}, [
        el("div", {}, [el("strong", {}, cfg.name + " assistant"), el("small", {}, "AI assistant - answers may be inaccurate")]),
        el("button", { type: "button", class: "close", "aria-label": "Close chat", onclick: function () { toggle(false); } }, "×"),
      ]),
      signup,
      log,
      form,
    ]);
    var launcher = el("button", { type: "button", class: "launcher", onclick: function () { toggle(true); } }, "💬 Ask us");
    root.append(panel, launcher);
    document.body.append(host);

    var starters = null;
    showView();
    if (session && session.open) toggle(true, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) toggle(false); });

    // Shows the registration form or the chat, depending on whether the visitor has registered.
    function showView() {
      signup.hidden = !!session;
      log.hidden = form.hidden = !session;
      if (session) buildLog();
    }

    function buildLog() {
      log.textContent = "";
      bubble("assistant", cfg.greeting);
      session.messages.forEach(function (m) { bubble(m.role, m.text); });
      starters = el("div", { class: "starters" });
      if (!session.messages.length) {
        (cfg.starters || []).forEach(function (q) {
          starters.append(el("button", { type: "button", onclick: function () { ask(q); } }, q));
        });
        if (starters.children.length) log.append(starters);
      }
    }

    function toggle(open, quiet) {
      panel.hidden = !open;
      launcher.hidden = open;
      if (session) { session.open = open; saveSession(); }
      if (open && !quiet) (session ? input : fields.name).focus();
    }

    function submitSignup(e) {
      e.preventDefault();
      if (starting) return;
      starting = true;
      signupBtn.disabled = true;
      signupError.textContent = "";
      fetch(base + "/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.name.value,
          email: fields.email.value,
          phone: fields.phone.value,
          description: fields.description.value,
        }),
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (b) { return { res: res, body: b }; }); })
        .then(function (r) {
          if (!r.res.ok) {
            signupError.textContent =
              r.res.status === 429 ? "Too many attempts - please try again in a few minutes."
              : r.body.error === "invalid_contact" ? "Please check your " + (r.body.field === "phone" ? "phone number" : r.body.field) + "."
              : "Sorry, we couldn't start the chat. Please try again later.";
            return;
          }
          session = { id: r.body.conversationId, messages: [], open: true };
          saveSession();
          showView();
          input.focus();
        })
        .catch(function () { signupError.textContent = "Connection problem - please try again."; })
        .finally(function () { starting = false; signupBtn.disabled = false; });
    }

    function bubble(role, text) {
      var b = el("div", { class: "msg " + role });
      render(b, text);
      log.append(b);
      log.scrollTop = log.scrollHeight;
      return b;
    }

    function ask(text) {
      text = (text || "").trim();
      if (!text || busy || !session) return;
      busy = true;
      send.disabled = true;
      input.value = "";
      if (starters) starters.remove();
      bubble("user", text);
      var out = bubble("assistant", "");
      out.classList.add("typing");
      out.textContent = "Typing…";

      fetch(base + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId: session.id }),
      })
        .then(function (res) {
          if (!res.ok || !res.body) {
            return res.json().catch(function () { return {}; }).then(function (b) {
              if (b.error === "registration_required") {
                // The server no longer knows this conversation: register again.
                session = null;
                saveSession();
                signupError.textContent = "Please enter your details to continue.";
                showView();
                return;
              }
              fail(out, res.status === 429
                ? "You're sending messages quickly - please wait a few minutes."
                : "Our assistant is unavailable right now. Please contact us directly.");
            });
          }
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var reply = "";
          return (function pump() {
            return reader.read().then(function (r) {
              if (r.done) {
                if (!reply.trim()) return fail(out, "Sorry, I couldn't come up with an answer. Please contact us.");
                // Only completed exchanges are kept, matching what the server records.
                session.messages.push({ role: "user", text: text }, { role: "assistant", text: reply });
                session.messages = session.messages.slice(-40);
                saveSession();
                return;
              }
              reply += decoder.decode(r.value, { stream: true });
              out.classList.remove("typing");
              render(out, reply);
              log.scrollTop = log.scrollHeight;
              return pump();
            });
          })();
        })
        .catch(function () { fail(out, "Connection problem - please try again."); })
        .finally(function () { busy = false; send.disabled = false; if (session) input.focus(); });
    }

    function fail(node, text) {
      node.classList.remove("typing");
      render(node, text);
    }

    // Safe renderer: **bold**, [label](link) only. Links must be a site path, mailto:
    // or https to one of the bot's own websites; anything else shows as plain text.
    function render(node, text) {
      node.textContent = "";
      text.split(/(\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*)/g).forEach(function (part) {
        var link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (link) {
          var href = safeHref(link[2]);
          return node.append(href ? el("a", { href: href, target: "_blank", rel: "noopener noreferrer" }, link[1]) : link[1]);
        }
        var bold = part.match(/^\*\*([^*]+)\*\*$/);
        node.append(bold ? el("strong", {}, bold[1]) : part);
      });
    }

    function safeHref(h) {
      if (h.charAt(0) === "/" && h.charAt(1) !== "/") return h;
      if (h.indexOf("mailto:") === 0) return h;
      try {
        var u = new URL(h);
        if (u.protocol === "https:" && (cfg.linkHosts || []).indexOf(u.host) !== -1) return u.href;
      } catch (e) { /* not a URL */ }
      return null;
    }
  }

  function css(accent) {
    return [
      ".panel{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111}",
      "*{box-sizing:border-box}",
      "[hidden]{display:none!important}",
      ".launcher{position:fixed;right:16px;bottom:16px;border:0;border-radius:999px;padding:12px 20px;background:" + accent + ";color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}",
      ".launcher:hover{opacity:.9}",
      ".panel{position:fixed;right:16px;bottom:16px;width:384px;max-width:calc(100vw - 24px);height:min(34rem,calc(100vh - 24px));display:flex;flex-direction:column;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25)}",
      "header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb}",
      "header strong{display:block;font-size:14px}header small{color:#6b7280;font-size:12px}",
      ".close{border:0;background:none;font-size:22px;line-height:1;color:#6b7280;cursor:pointer;border-radius:8px;padding:2px 8px}",
      ".close:hover{background:#e5e7eb}",
      ".log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}",
      ".msg{max-width:85%;padding:10px 14px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}",
      ".msg.assistant{align-self:flex-start;background:#f3f4f6}",
      ".msg.user{align-self:flex-end;background:" + accent + ";color:#fff}",
      ".msg.typing{color:#6b7280}",
      ".msg a{color:inherit;font-weight:600;text-decoration:underline}",
      ".starters{display:flex;flex-wrap:wrap;gap:8px}",
      ".starters button{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:6px 12px;font:12px system-ui,sans-serif;text-align:left;cursor:pointer}",
      ".starters button:hover{background:#f3f4f6}",
      ".form{border-top:1px solid #e5e7eb;padding:12px}",
      ".row{display:flex;gap:8px}",
      "input,textarea{border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font:14px system-ui,sans-serif;outline:none}",
      ".row input{flex:1;min-width:0}",
      "input:focus,textarea:focus{border-color:" + accent + "}",
      ".send{border:0;border-radius:8px;padding:8px 16px;background:" + accent + ";color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer}",
      ".send:disabled{opacity:.5;cursor:default}",
      ".note{margin:8px 0 0;font-size:11px;line-height:1.4;color:#6b7280}.note a{color:inherit}",
      ".signup{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}",
      ".signup h3{margin:0;font-size:15px}",
      ".signup p{margin:0;font-size:12px;color:#6b7280}",
      ".signup label{display:block;font-size:12px;font-weight:600}",
      ".signup input,.signup textarea{display:block;width:100%;margin-top:4px;font-weight:400}",
      "textarea{resize:vertical}",
      ".signup .err{color:#b91c1c;min-height:1em}",
      ".signup .note{margin:0}",
    ].join("\n");
  }
})();
