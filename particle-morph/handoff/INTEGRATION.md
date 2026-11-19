# Внедрение на сайт: подробная инструкция

Компонент самодостаточный: свой canvas, свой цикл анимации, своя обработка мыши и размеров. От сайта нужно четыре вещи:
1. Контейнер нужного размера.
2. Модели по известному адресу.
3. Значение прокрутки от 0 до 1.
4. Вызов `dispose()` при уходе со страницы, если сайт SPA.

## 1. Файлы

```
src/components/particle-morph/   ← папка particle-morph/ из пакета, без изменений
public/models/*.glb               ← папка models/ из пакета (5 файлов)
```

Пути могут быть любыми. Компонент ищет модели по адресу `<base>models/<файл>.glb`, где `base` передаётся в `SHOWCASE_MODELS(base)`:
- модели в `public/models/` → `SHOWCASE_MODELS('/')`;
- модели на CDN `https://cdn.example.com/3d/models/` → `SHOWCASE_MODELS('https://cdn.example.com/3d/')`. CDN должен отдавать CORS-заголовок.

## 2. Зависимости

```bash
npm install three@0.187.0 three-mesh-bvh@0.9.18 gsap@3.15.1
```

Версии зафиксированы: именно с ними всё проверено. GSAP нужен только для привязки к прокрутке (`ScrollController.js`). Если на сайте уже есть GSAP 3.x, подойдёт он.

Сайт без сборщика (обычный HTML, Tilda, Webflow с собственным кодом): зависимости подключаются с CDN через `<script type="importmap">`. Готовый рабочий пример лежит в `examples/vanilla/index.html`.

## 3. Вёрстка секции

```html
<section id="morph-section" style="height: 900vh; position: relative;">
  <div id="morph-stage" style="position: sticky; top: 0; height: 100vh;"></div>
</section>
```

- `900vh` — длина прокрутки, за которую проходят все 5 объектов (примерно два экрана на каждое превращение). Её можно менять: меньше — быстрее, больше — медленнее.
- Внутрь `#morph-stage` компонент сам вставляет `<canvas>` на весь размер блока. Поверх можно класть свои элементы (заголовки и т. п.): они будут поверх частиц.
- Фон страницы в этом месте белый.

### Режим наложения: главный подводный камень

Частицы рисуются белыми, и CSS `mix-blend-mode: difference` превращает их в чёрные на белом фоне. Это работает, только если наложение «видит» фон страницы.

- Передавайте `cssBlendTarget: 'container'`. Тогда эффект вешается на `#morph-stage` и работает внутри sticky/fixed-блока.
- **У родителей `#morph-stage` не должно быть** свойств `transform`, `filter`, `opacity < 1`, `isolation: isolate`, `will-change`, `contain: paint`, а также `z-index` у позиционированного элемента. Иначе частицы станут белыми на белом, то есть невидимыми. Обычно такие свойства добавляют анимации появления секций и обёртки плавной прокрутки.
- Если без них никак, есть запасной режим: `blendMode: 'shader', background: '#ffffff'`. Внешне то же самое на однотонном фоне, но содержимое под canvas он уже не инвертирует.

Побочный эффект режима `difference`: если поверх или под секцией есть чёрный текст, в местах пересечения с частицами он инвертируется. Это часть эстетики референса.

## 4. Подключение (обычный JS)

```js
import { ParticleMorphScene, SHOWCASE_MODELS } from './components/particle-morph/index.js';
import { ScrollController } from './components/particle-morph/ScrollController.js';

const section = document.getElementById('morph-section');
const stage = document.getElementById('morph-stage');

let scene, scroll;

async function init() {
  scene = new ParticleMorphScene(stage, {
    models: SHOWCASE_MODELS('/'),
    cssBlendTarget: 'container',
  });
  await scene.load();
  scroll = new ScrollController({
    trigger: section, start: 'top top', end: 'bottom bottom', scrub: 0.8,
    onUpdate: (p) => scene.setMorphProgress(p),
  });
}

// 1) грузим заранее: когда до секции остаётся ~1 экран
const preload = new IntersectionObserver(([e]) => {
  if (e.isIntersecting) { preload.disconnect(); init(); }
}, { rootMargin: '100% 0px' });
preload.observe(section);

// 2) анимация работает только пока секция реально на экране
let visible = false;
new IntersectionObserver(([e]) => {
  visible = e.isIntersecting;
  if (scene?.ready) visible ? scene.start() : scene.stop();
}).observe(section);
// (в init() после load(): if (!visible) scene.stop();)
```

Настройки эффекта (размер частиц, сила разлёта и т. д.) уже зашиты в `config.js`, передавать их не нужно.

## 5. React / Next.js

Готовый компонент секции лежит в `examples/react/ParticleMorphSection.jsx`. Что в нём учтено:
- `'use client'` и динамический `import()` внутри `useEffect`, поэтому three.js не попадает в SSR;
- корректная очистка (`dispose()`), в том числе при двойном монтировании в React StrictMode;
- ленивый старт и пауза вне экрана.

Использование: `<ParticleMorphSection assetsBase="/" />`.

## 6. Плавная прокрутка (Lenis, Locomotive)

`ScrollController` работает на GSAP ScrollTrigger. Если на сайте есть Lenis:
```js
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
```
Другой вариант — не использовать `ScrollController`, а самому считать прогресс секции (0…1) и вызывать `scene.setMorphProgress(p)`.

Если высота содержимого над секцией меняется после загрузки (шрифты, картинки, аккордеоны), вызовите `scroll.refresh()`.

## 7. Загрузка и производительность

- **Вес.** ~30 МБ моделей; больше всего весят конь (12 МБ) и MacBook (11 МБ). Включите на сервере/CDN сжатие gzip или brotli для `.glb`, файлы хорошо жмутся. Долгое кеширование (`Cache-Control: max-age=31536000, immutable`) тоже стоит включить.
- **Пауза после скачивания.** После загрузки моделей браузер ~3–4 секунды строит облака точек в основном потоке, и страница в это время не отвечает. Поэтому загрузка запускается заранее, когда до секции ещё экран прокрутки, а не при открытии страницы.
- **Во время работы.** Вся анимация считается на видеокарте. Вне экрана её стоит ставить на паузу (`scene.stop()`), в примерах это уже сделано.
- **Телефоны.** Прототип делался и тестировался на десктопе. На сенсорных экранах нет наведения, поэтому поворот за курсором и разлёт частиц не срабатывают; прокрутка и превращения работают. Для слабых устройств можно уменьшить число частиц: облака станут реже, вид тот же.
  ```js
  const mobile = matchMedia('(pointer: coarse)').matches;
  new ParticleMorphScene(stage, { models: SHOWCASE_MODELS('/'), cssBlendTarget: 'container',
    ...(mobile && { particleCount: 20000, maxPixelRatio: 1.5 }) });
  ```
  Перед публикацией обязательно проверьте на реальных телефонах.
- **Доступность.** Для пользователей с `prefers-reduced-motion` можно убрать разлёт и вращение:
  ```js
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    scene.updateConfig({ interactionEnabled: false, lookAtIntensity: 0, morphScatter: 0, morphTwist: 0, noiseIntensity: 0.05 });
  }
  ```

## 8. Content-Security-Policy

Если на сайте есть CSP, она должна разрешать:
- адрес моделей в `connect-src`;
- `blob:` в `img-src`: так декодируются текстуры внутри моделей;
- скрипты three/gsap, если они грузятся с CDN.

`unsafe-eval` не нужен.

## 9. Что проверить после внедрения

- [ ] Порядок при прокрутке: конь (начало) → турник (25%) → катана (50%) → синтезатор (75%) → MacBook (конец); назад — в обратном порядке.
- [ ] Частицы чёрные на белом. Если их не видно, см. «Режим наложения» в разделе 3.
- [ ] Фигура поворачивается за мышью; при наведении частицы разлетаются и собираются.
- [ ] После секции страница продолжается нормально, без скачков прокрутки.
- [ ] Нет ошибок в консоли; при переходах между страницами (SPA) не появляются лишние canvas.
- [ ] Вне экрана анимация на паузе: во вкладке Performance браузера нет постоянной нагрузки.
- [ ] Проверено на телефоне.

## Если что-то не так

| симптом | причина |
|---|---|
| Пустая белая секция, ошибок нет | у родителя есть stacking context (см. раздел 3) или белый фон + `cssBlendTarget: 'canvas'` внутри sticky |
| «Failed to load» / 404 в консоли | неверный `base` в `SHOWCASE_MODELS` или модели не в статике |
| Текстуры не загружаются (синтезатор без клавиш) | CSP не разрешает `blob:` в `img-src` |
| Морфинг не реагирует на прокрутку | неверный `trigger`, плавная прокрутка без интеграции со ScrollTrigger, или нужен `scroll.refresh()` |
| Секция «прыгает» | у sticky-блока или родителя есть `transform`/`overflow: hidden` |
| Частицы крупные или мелкие на другом мониторе | так и задумано: размер в CSS-пикселях с учётом плотности экрана, ограничение `maxPixelRatio: 2` |

Полное техническое описание (архитектура, все параметры, API) лежит в `TECHNICAL.md`.
