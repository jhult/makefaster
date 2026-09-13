/**
 * Homepage playback of a real makefaster run. The .cast is a cropped
 * retiming of an asciinema capture that plays through to the fastest run
 * and holds (see scripts/edit-loop-cast.mjs).
 *
 * Light DOM so css/style.css can frame the player the same way it frames the
 * copyable command. Asciinema-player is loaded on demand so the leaderboard
 * pages never pay for it.
 */

export const CAST_SRC = "/assets/makefaster-loop.cast";
export const PLAYER_SRC = "/vendor/asciinema-player.min.js";
export const PLAYER_CSS = "/vendor/asciinema-player.css";

/** Fastest starred run in the retimed file: ★3001 ms LCP. */
export const HOLD = 17.41;
export const POSTER = "npt:17.41";

const PLAYER_OPTS = {
  cols: 141,
  rows: 45,
  autoplay: true,
  loop: false,
  preload: true,
  poster: POSTER,
  fit: "width",
  controls: "auto",
  theme: "asciinema",
  terminalFontFamily: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
  terminalLineHeight: 1.2,
};

let playerAssets = null;

function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function loadPlayerAssets() {
  if (playerAssets) return playerAssets;
  playerAssets = new Promise(function (resolve, reject) {
    if (!document.querySelector('link[href="' + PLAYER_CSS + '"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = PLAYER_CSS;
      document.head.appendChild(link);
    }
    if (window.AsciinemaPlayer) {
      resolve(window.AsciinemaPlayer);
      return;
    }
    const script = document.createElement("script");
    script.src = PLAYER_SRC;
    script.onload = function () {
      if (window.AsciinemaPlayer) resolve(window.AsciinemaPlayer);
      else reject(new Error("asciinema-player did not load"));
    };
    script.onerror = function () {
      reject(new Error("asciinema-player failed to load"));
    };
    document.head.appendChild(script);
  });
  return playerAssets;
}

function holdOnFastest(player, host) {
  var held = false;
  function hold() {
    if (held || !player) return;
    held = true;
    if (typeof player.pause === "function") player.pause();
    if (host) host.classList.add("is-held");
  }
  function tick() {
    if (!player || held) return;
    var time = typeof player.getCurrentTime === "function" ? player.getCurrentTime() : 0;
    if (time >= HOLD) {
      hold();
      return;
    }
    requestAnimationFrame(tick);
  }
  if (typeof player.addEventListener === "function") {
    player.addEventListener("play", function () {
      held = false;
      requestAnimationFrame(tick);
    });
    player.addEventListener("ended", hold);
  }
  requestAnimationFrame(tick);
}

class LoopDemo extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <div class="loop-demo">
        <div class="loop-window">
          <div class="loop-window-titlebar">
            <div class="loop-window-lights" aria-hidden="true">
              <span class="loop-window-light loop-window-light--close"></span>
              <span class="loop-window-light loop-window-light--min"></span>
              <span class="loop-window-light loop-window-light--zoom"></span>
            </div>
            <span class="loop-window-title">portainer — zsh</span>
          </div>
          <div class="loop-demo-player" role="img" aria-label="Recording of a makefaster run against Portainer, played through to the fastest run."></div>
        </div>
      </div>`;

    this.mount();
  }

  disconnectedCallback() {
    this.teardown();
  }

  mount() {
    var self = this;
    var host = this.querySelector(".loop-demo-player");
    var reduced = prefersReducedMotion();
    loadPlayerAssets().then(
      function (AsciinemaPlayer) {
        if (!self.isConnected) return;
        var opts = Object.assign({}, PLAYER_OPTS, {
          autoplay: !reduced,
        });
        self.player = AsciinemaPlayer.create(CAST_SRC, host, opts);
        if (!reduced) holdOnFastest(self.player, host);
      },
      function () {
        if (!host) return;
        host.textContent = "The loop recording could not be loaded.";
      }
    );
  }

  teardown() {
    if (this.player && typeof this.player.dispose === "function") {
      this.player.dispose();
    }
    this.player = null;
  }
}

customElements.define("loop-demo", LoopDemo);
