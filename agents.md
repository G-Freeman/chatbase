# Codex Agent Cheat Sheet

## Общие правила
- Всегда отвечай пользователю на русском, даже если вопрос на другом языке.
- Перед ответом сверяйся с этим файлом на случай новых договорённостей.

## Частые команды
- `docs:gen` — пересобрать Scalar-схемы (HTTP/WS) → `packages/docs/public/schemas/*`.
- `docs:start` — поднять Vite-сервер документации (`packages/docs`).
- `front:start` — запустить витрины фронтенда (`packages/front`).

## Каркас проекта
- `package.json` — общие скрипты и devDependencies.
- `packages/`
  - `api/`
    - `http/` — `HttpClient` (`index.ts`) + обёртки (`auth.ts`, `user.ts`).
    - `socket/` — `WSClient` (`index.ts`) и пример (`example.ts`).
  - `docs/`
    - `package.json` — локальные зависимости для Scalar (`@scalar/api-reference`).
    - `index.html` — корень Vite-приложения, подключает `src/main.ts`.
    - `src/main.ts` — инициализация Scalar компонентов, подключение схем.
    - `public/schemas/` — актуальные схемы, генерятся скриптом и раздаются Vite.
    - `vite.config.ts` — конфиг для `pnpm docs:start` (publicDir = `schemas`).
  - `generators/`
    - `gen.ts` — основная логика сборки Scalar (учитывает дефолты и комментарии).
  - `types/` — доменные типы (`index.ts`).
  - `front/` — Vitest/React-клиент (поднимается через `front:start`).

## Как обновлять документацию
1. Внести изменения в `packages/api` или `packages/types`.
2. Запустить `docs:gen` — обновятся `public/schemas/http.json`, `public/schemas/socket.json`.
3. Убедиться, что зависимости в `packages/docs` установлены (`pnpm install`).
4. Проверить рендер через `docs:start` (Vite откроет Scalar UI).

## Что проверять перед ответом
- Есть ли локальные незакоммиченные изменения, которые затронули задание (`git status -sb`).
- Скомпилировались ли скрипты/генераторы; при необходимости сообщить о шагах для проверки.
- Нужно ли обновить этот файл (структура, новые правила, скрипты). Если да — дописать.
