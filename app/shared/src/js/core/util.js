
function escapeHtml(text) {
	if (typeof text !== 'string') return '';
	var div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML; // Provizórne riešenie na prevod HTML do bezpečnej podoby.
}


function cloneTemplate(templateId, data = {}) {
	var template = document.getElementById(templateId);
	if (!template) {
		Logger.warn('Template not found:', templateId);
		return null;
	}
	var clone = template.content.cloneNode(true).firstElementChild;

	Object.entries(data).forEach(([selector, value]) => {
		var el = clone.querySelector(selector);
		if (!el) return;

		if (typeof value === 'string') {
			el.textContent = value;
		} else if (typeof value === 'object') {
			if (value.text) el.textContent = value.text;
			if (value.html) el.innerHTML = value.html;
			if (value.class) el.className += ' ' + value.class;
			if (value.attrs) {
				Object.entries(value.attrs).forEach(([attr, val]) => el.setAttribute(attr, val));
			}
		}
	});

	return clone;
}

function debounce(fn, delay) {
	var timeout;
	return function(...args) {
		clearTimeout(timeout);
		timeout = setTimeout(() => fn.apply(this, args), delay);
	};
}





function getColorForId(id) {
	var hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = id.charCodeAt(i) + ((hash << 5) - hash);
	}
	var hue = hash % 360;
	return `hsl(${hue}, 60%, 50%)`;
}

function createAsyncFormHandler(submitFn, onSuccess) {
	return async (e) => {
		e.preventDefault();
		var form = e.target;
		var errorEl = form.querySelector('.auth-error, .form-error, [class*="error"]');
		var submitBtn = form.querySelector('button[type="submit"]');

		try {
			if (errorEl) errorEl.textContent = '';
			if (submitBtn) submitBtn.disabled = true;

			await submitFn(form);
			if (onSuccess) onSuccess(form);
		} catch (err) {
			if (errorEl) errorEl.textContent = err.message;
		} finally {
			if (submitBtn) submitBtn.disabled = false;
		}
	};
}

function setupCanvasResize(canvas, height, drawCallback) {
	return () => {
		var container = canvas.parentElement;
		if (!container) return;
		var rect = container.getBoundingClientRect();
		if (rect.width === 0) return;

		var dpr = window.devicePixelRatio || 1;
		var width = rect.width;

		canvas.width = width * dpr;
		canvas.height = height * dpr;
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';

		var ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (drawCallback) drawCallback();
	};
}


// V podobe objektu pre prehľadnosť a ľahšie vyhľadanie funkcií v súbore.
window.SpectraUtil = {
	escapeHtml,
	debounce,
	getColorForId,
	createAsyncFormHandler,
	setupCanvasResize
};
