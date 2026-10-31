// QR Code de convite.
// O QR guarda um link do próprio Pago com o convite (#convite=<espaço>.<código>). Assim ele funciona
// de dois jeitos: pela câmera comum do celular (abre o Pago já com o convite) ou pelo leitor dentro
// do app. A senha do espaço nunca vai no QR.
import { esc } from '../lib/util.js';
import { icon } from './ui.js';

export const inviteLink = (code) => `${location.origin}${location.pathname}#convite=${encodeURIComponent(code)}`;

// Aceita o link completo, só o código, ou o código com espaços/quebras.
export function parseInvite(text) {
  const t = String(text || '').trim();
  const m = t.match(/[#&?]convite=([^&\s]+)/);
  const raw = m ? decodeURIComponent(m[1]) : t;
  return /^[a-z0-9]{8,}\.[a-z0-9]{6,}$/i.test(raw) ? raw : '';
}

export async function qrSvg(text) {
  const { default: qrcode } = await import('../vendor/qrcode.js');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
}

/* ---------- Leitor pela câmera ----------
   Usa o leitor nativo do navegador (BarcodeDetector) quando existe; senão, decodifica os quadros
   do vídeo com jsQR, carregado só nesse momento. Resolve com o texto lido, ou null se cancelado. */
export function scanQR({ title = 'Ler QR Code do convite' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'scan';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', title);
    wrap.innerHTML = `
      <video playsinline muted></video>
      <div class="scan-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="scan-top"><b>${esc(title)}</b><span data-msg>Aponte a câmera para o QR Code.</span></div>
      <div class="scan-bottom"><button type="button" class="btn" data-cancel>${icon('x')}Cancelar</button></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const video = wrap.querySelector('video');
    const msg = wrap.querySelector('[data-msg]');
    let stream = null;
    let done = false;
    let timer = 0;

    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      window.removeEventListener('keydown', onKey, true);
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 180);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    wrap.querySelector('[data-cancel]').onclick = () => finish(null);

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        msg.textContent = 'Este navegador não permite usar a câmera. Digite o código.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        msg.textContent =
          e.name === 'NotAllowedError'
            ? 'Acesso à câmera negado. Libere a câmera para este site nas configurações do navegador, ou digite o código.'
            : 'Não foi possível abrir a câmera. Digite o código.';
        return;
      }
      if (done) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});

      let detect;
      if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats?.())?.includes('qr_code')) {
        const bd = new BarcodeDetector({ formats: ['qr_code'] });
        detect = async () => (await bd.detect(video))[0]?.rawValue || '';
      } else {
        const { default: jsQR } = await import('../vendor/jsqr.js');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        detect = async () => {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return '';
          const k = Math.min(1, 640 / Math.max(w, h));
          canvas.width = Math.round(w * k);
          canvas.height = Math.round(h * k);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || '';
        };
      }

      const loop = async () => {
        if (done) return;
        try {
          const text = await detect();
          if (text) {
            if (parseInvite(text)) {
              navigator.vibrate?.(30);
              return finish(text);
            }
            msg.textContent = 'Esse QR Code não é um convite do Pago.';
          }
        } catch {
          /* quadro ainda não disponível */
        }
        timer = setTimeout(loop, 160);
      };
      loop();
    })();
  });
}
