import { setNickname } from '../game/game-state.js';

// 한글·영문·숫자와 일부 특수문자(._-), 2~12자, 공백 불가.
// (완성형 한글만 허용 — 자모 단독 ㄱ, ㅏ 등은 제외)
const NICK_RE = /^[가-힣A-Za-z0-9._-]{2,12}$/;

export function showNicknameSetup() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('auth-overlay');
    const container = document.getElementById('auth-container');
    overlay.classList.remove('hidden');

    container.innerHTML = `
      <h1 class="auth-title">건물주</h1>
      <p class="auth-subtitle">사용할 닉네임을 정하세요</p>
      <div class="nick-setup">
        <input id="nick-input" class="nick-input" type="text" maxlength="12"
          placeholder="닉네임" autocomplete="off" spellcheck="false" />
        <p class="nick-hint">한글·영문·숫자 2~12자 (공백 불가)</p>
        <p id="nick-error" class="nick-error hidden"></p>
        <button id="nick-submit" class="nick-submit" disabled>시작하기</button>
      </div>
    `;

    const input = container.querySelector('#nick-input');
    const errEl = container.querySelector('#nick-error');
    const submit = container.querySelector('#nick-submit');

    function validate() {
      const v = input.value.trim();
      if (v.length === 0) return { ok: false, msg: '' };
      if (v.length < 2) return { ok: false, msg: '2자 이상 입력하세요.' };
      if (v.length > 12) return { ok: false, msg: '12자 이하여야 합니다.' };
      if (!NICK_RE.test(v)) return { ok: false, msg: '한글·영문·숫자와 . _ - 만 사용할 수 있어요 (공백 불가).' };
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
      await setNickname(input.value.trim());
      overlay.classList.add('hidden');
      resolve(input.value.trim());
    }

    submit.addEventListener('click', finish);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
    input.focus();
  });
}
