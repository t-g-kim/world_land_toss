import { setNickname } from '../game/game-state.js';

// English letters, digits, and special characters only (no spaces, no non-ASCII
// e.g. Korean). 2–30 characters.
const NICK_RE = /^[\x21-\x7E]{2,30}$/;

export function showNicknameSetup() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('auth-overlay');
    const container = document.getElementById('auth-container');
    overlay.classList.remove('hidden');

    container.innerHTML = `
      <h1 class="auth-title">someday</h1>
      <p class="auth-subtitle">사용할 닉네임을 정하세요</p>
      <div class="nick-setup">
        <input id="nick-input" class="nick-input" type="text" maxlength="30"
          placeholder="Nickname" autocomplete="off" spellcheck="false" />
        <p class="nick-hint">영문·숫자·특수문자만, 30자 이하 (공백·한글 불가)</p>
        <p id="nick-error" class="nick-error hidden"></p>
        <button id="nick-submit" class="nick-submit" disabled>시작하기</button>
      </div>
    `;

    const input = container.querySelector('#nick-input');
    const errEl = container.querySelector('#nick-error');
    const submit = container.querySelector('#nick-submit');

    function validate() {
      const v = input.value;
      if (v.length === 0) return { ok: false, msg: '' };
      if (v.length > 30) return { ok: false, msg: '30자 이하여야 합니다.' };
      if (v.length < 2) return { ok: false, msg: '2자 이상 입력하세요.' };
      if (!NICK_RE.test(v)) return { ok: false, msg: '영문·숫자·특수문자만 사용할 수 있어요 (공백·한글 불가).' };
      return { ok: true, msg: '' };
    }

    function refresh() {
      const { ok, msg } = validate();
      submit.disabled = !ok;
      errEl.textContent = msg;
      errEl.classList.toggle('hidden', !msg);
    }

    input.addEventListener('input', refresh);

    async function finish() {
      const { ok } = validate();
      if (!ok) return;
      submit.disabled = true;
      await setNickname(input.value);
      overlay.classList.add('hidden');
      resolve(input.value);
    }

    submit.addEventListener('click', finish);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
    input.focus();
  });
}
