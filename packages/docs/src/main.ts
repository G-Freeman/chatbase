import { createApiReference } from '@scalar/api-reference';
import '@scalar/api-reference/style.css';

const app = document.getElementById('app');

if (!app) {
	throw new Error('Не найден контейнер #app для Scalar.');
}

async function mountScalar(target: HTMLElement, kind: 'http' | 'ws') {
	const specUrl = kind === 'ws' ? '/schemas/socket.json' : '/schemas/http.json';
	return createApiReference(target, {
		layout: 'modern',
		locale: 'ru',
		spec: {
			url: specUrl,
			type: 'openapi',
		},
		tryItClient: {
			sendHeaders: true,
			autoExecute: false,
		},
		hideClient: kind === 'ws',
		hideModels: false,
		hideSchemas: false,
		hideClientButton: kind === 'ws',
		hideTestRequestButton: kind === 'ws',
		preselectedCodeLanguage: kind === 'ws' ? 'WebSocket' : 'Axios',
		selectedClient: kind === 'ws' ? 'custom/WebSocket' : 'Axios',
		metaData: {
			title: 'Betting API',
		},
	});
}

const createSection = (title: string, description: string, kind: 'http' | 'ws') => {
	const section = document.createElement('section');
	section.className = 'scalar-wrapper';

	const header = document.createElement('div');
	header.className = 'scalar-header';

	const h2 = document.createElement('h2');
	h2.textContent = title;
	header.appendChild(h2);

	const p = document.createElement('p');
	p.textContent = description;
	header.appendChild(p);

	const scalarHost = document.createElement('div');
	scalarHost.className = 'scalar-host';
	scalarHost.dataset.kind = kind;

	section.appendChild(header);
	section.appendChild(scalarHost);

	try {
		mountScalar(scalarHost, kind);
	} catch (err) {
		console.error('Не удалось инициализировать Scalar', err);
		scalarHost.innerHTML = `<div class="scalar-error">Ошибка инициализации Scalar: ${String(err)} </div>`;
	}
	return section;
};

const page = document.createElement('main');
page.className = 'scalar-page';

const hero = document.createElement('header');
hero.className = 'scalar-hero';

const title = document.createElement('h1');
title.textContent = 'Документация Betting API';

const subtitle = document.createElement('p');
subtitle.innerHTML =
	'Интерактивные спецификации для HTTP и WebSocket. Схемы генерируются командой <code>pnpm docs:gen</code> и доступны для отладки запросов через Scalar.';

hero.appendChild(title);
hero.appendChild(subtitle);

page.appendChild(hero);
page.appendChild(
	createSection(
		'HTTP API',
		'OpenAPI 3.1 спецификация, собранная из пакета packages/api/http.',
		'http',
	),
);
page.appendChild(
	createSection(
		'WebSocket API',
		'OpenAPI спецификация, собранная из пакета packages/api/socket.',
		'ws',
	),
);

const style = document.createElement('style');
style.textContent = `
	body {
		margin: 0;
		font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
		background: radial-gradient(circle at top left, rgba(99, 102, 241, 0.18), transparent 55%), #090712;
		color: rgba(255, 255, 255, 0.92);
	}
	.scalar-hero {
		padding: clamp(2rem, 6vw, 3.5rem) clamp(1.5rem, 6vw, 4rem);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}
	.scalar-hero h1 {
		margin: 0 0 0.75rem;
		font-size: clamp(2rem, 4vw, 3rem);
	}
	.scalar-hero p {
		margin: 0;
		max-width: 48rem;
		color: rgba(255, 255, 255, 0.75);
	}
	.scalar-page {
		display: grid;
		gap: clamp(1.5rem, 5vw, 3rem);
		padding: clamp(1.5rem, 5vw, 3rem) clamp(1.5rem, 6vw, 4rem) 4rem;
	}
	.scalar-wrapper {
		background: rgba(12, 10, 24, 0.9);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 20px;
		overflow: hidden;
		box-shadow: 0 24px 44px rgba(0, 0, 0, 0.45);
		display: flex;
		flex-direction: column;
	}
	.scalar-header {
		padding: clamp(1.5rem, 4vw, 2.5rem);
	}
	.scalar-header h2 {
		margin: 0 0 0.5rem;
		font-size: clamp(1.4rem, 3vw, 2rem);
	}
	.scalar-header p {
		margin: 0;
		color: rgba(255, 255, 255, 0.7);
	}
	.scalar-host {
		position: relative;
	}
	.scalar-host .scalar-app {
		flex: 1;
	}
	.scalar-host[data-kind='ws'] [data-testid="client-picker"],
	.scalar-host[data-kind='ws'] .scalar-code-sample-selector,
	.scalar-host[data-kind='ws'] .scalar-code-sample__language {
		display: none !important;
	}
	.references-navigation-list {
		height: 100%!important;
	}
	@media (max-width: 1024px) {
		.scalar-page {
			padding: clamp(1rem, 4vw, 2rem);
		}
		.scalar-wrapper {
			border-radius: 16px;
		}
	}
`;

document.head.appendChild(style);
app.appendChild(page);
