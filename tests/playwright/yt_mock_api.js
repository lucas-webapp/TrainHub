(function () {
  function Player(target, opts) {
    var self = this, f = document.createElement('iframe');
    f.src = 'http://localhost:8766/embed.html?id=' + opts.videoId + (window.__QUIRK === false ? '' : '&quirk=1');
    f.setAttribute('allowfullscreen', ''); f.setAttribute('allow', 'autoplay; fullscreen');
    target.parentNode.replaceChild(f, target);
    this._f = f; this._s = -1;
    window.addEventListener('message', function (e) {
      var m = e.data; if (!m || !m.ytmock || m.id !== opts.videoId) return;
      if (m.event === 'ready' && opts.events && opts.events.onReady) opts.events.onReady({ target: self });
      if (m.event === 'state') { self._s = m.data; if (opts.events && opts.events.onStateChange) opts.events.onStateChange({ data: m.data, target: self }); }
    });
  }
  Player.prototype = {
    getIframe: function () { return this._f; },
    playVideo: function () { this._f.contentWindow.postMessage({ ytcmd: 'playVideo' }, '*'); window.__ytCalls = (window.__ytCalls || []).concat('play'); },
    pauseVideo: function () { this._f.contentWindow.postMessage({ ytcmd: 'pauseVideo' }, '*'); window.__ytCalls = (window.__ytCalls || []).concat('pause'); },
    getPlayerState: function () { return this._s; }, getCurrentTime: function () { return 0; }, getDuration: function () { return 100; },
    getVolume: function () { return 100; }, setVolume: function () { }, getPlaybackRate: function () { return 1; }, setPlaybackRate: function () { }, seekTo: function () { },
    getAvailablePlaybackRates: function () { return [0.5, 1, 1.5, 2]; }, isMuted: function () { return false; }
  };
  window.YT = { Player: Player };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
