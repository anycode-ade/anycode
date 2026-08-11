# Пустота при виртуальном скролле больших файлов

## Симптом

При перетаскивании scrollbar на большое расстояние браузер немедленно меняет
`scrollTop`, но новые строки появляются только после выполнения JavaScript,
layout и paint. В промежутке редактор показывает пустую область. Иногда на один
кадр видны старые строки, уже не соответствующие новой позиции scrollbar.

Это особенно заметно на файлах в десятки тысяч строк и при прыжке через scrollbar.
Отключение syntax highlighting и scrollbar markers уменьшает стоимость кадра,
но не устраняет пустоту.


## Как сейчас устроен Anycode

Текущий renderer хранит в каждой из четырёх колонок следующую структуру:

```text
top spacer
rendered rows
bottom spacer
```

Колонки:

- buttons;
- gutter;
- folds;
- code.

Полная высота документа создаётся суммой двух пустых spacer-элементов и
отрисованного диапазона. При скролле [`Renderer.renderScroll`](anycode-base/src/renderer/Renderer.ts)
вычисляет новый диапазон и передвигает строки между spacer-элементами.

Формула диапазона для строк фиксированной высоты сама по себе корректна:

```ts
firstVisible = Math.floor(scrollTop / lineHeight)
startIndex = Math.max(0, firstVisible - buffer)
endIndex = Math.min(totalRows, startIndex + visibleCount + buffer * 2)
```

Проблема возникает не из-за `startIndex`/`endIndex`, а из-за временной гонки
между нативным скроллом браузера и обновлением DOM.

## Почему появляется пустота

Нативный скролл частично выполняется compositor-потоком и не ждёт JavaScript:

1. Пользователь перемещает scrollbar.
2. Браузер сразу устанавливает новый `scrollTop`.
3. Viewport перемещается на новую координату внутри уже существующего DOM.
4. На этой координате пока находится пустой `top spacer` или `bottom spacer`.
5. Scroll event попадает на main thread.
6. В следующем `requestAnimationFrame` Anycode вычисляет диапазон и создаёт строки.
7. Затем браузер выполняет style/layout/paint и только после этого показывает строки.

Даже если `renderScroll` занимает около 5–8 ms, это не означает, что результат
обязательно попадёт в текущий кадр. В frame budget также входят обработка события,
создание token span-элементов, DOM mutations, style recalculation, layout, paint и
compositing. Поэтому в trace встречаются кадры длительностью 25–54 ms, хотя сама
выбранная функция заметно короче.

При далёком прыжке старые строки физически остаются около старой позиции документа.
Новый viewport уже находится далеко от них и видит только spacer. Синхронный вызов
`renderScroll` сокращает окно проблемы, но не меняет эту архитектуру.

## Почему локальные оптимизации не решают проблему

Полезно, но недостаточно:

- не пересобирать `visualRows` при каждом scroll event;
- не вызывать `updateContentMinWidth` во время скролла;
- отключать scrollbar markers для файлов больше 5000 строк;
- не запускать syntax highlighting для неподдерживаемого расширения;
- добавить `overflow-anchor: none`;
- увеличить buffer;
- вызвать render синхронно из scroll handler.

Эти изменения уменьшают main-thread work, но viewport всё равно может попасть в
пустой spacer раньше, чем новый DOM будет готов. Слишком большой buffer также
увеличивает количество создаваемых строк и делает первый кадр после прыжка тяжелее.

## Как это решено в Pierre

Исследован репозиторий `pierrecomputer/pierre` на commit
`de681d76f0f940eb4a92976756d65b0adc22cc25`.

Pierre разделяет две задачи, которые в Anycode сейчас объединены:

1. стабильная геометрия всей scrollable области;
2. небольшой DOM-слой с текущим видимым содержимым.

### 1. Стабильная высота документа

Полная высота задаётся отдельным scroll scaffold. Она не зависит от того, какие
строки сейчас смонтированы. Замена видимого диапазона поэтому не схлопывает
scrollable область и не заставляет browser заново вычислять scrollbar из четырёх
наборов spacer-элементов.

См. `syncContainerHeight` в
[`CodeView.ts`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/components/CodeView.ts#L3375-L3384).

### 2. Один sticky-контейнер для видимого DOM

Rendered items находятся в одном `position: sticky` контейнере. Отдельный offset
задаёт его логическую позицию в документе, а отрицательные `top`/`bottom` дают
контейнеру запас движения вокруг viewport.

Если Safari успел прокрутить дальше, чем main thread успел обновить диапазон,
sticky-слой остаётся около viewport вместо того, чтобы полностью исчезнуть и
оставить пустой spacer.

См. создание sticky-контейнера и расчёт его позиции:

- [`CodeView.ts: constructor`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/components/CodeView.ts#L782-L793);
- [`CodeView.ts: applyStickyPositioning`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/components/CodeView.ts#L3423-L3443).

Важно использовать один общий вертикальный sticky-слой, а не четыре независимых
sticky-колонки. Safari дорого обрабатывает несколько sticky descendants, особенно
если их `transform`, `top`, `bottom` или размеры меняются на каждом scroll frame.

### 3. Отдельный fast path для далёкого прыжка

Pierre сравнивает новый `scrollTop` с последней отрисованной позицией. Если прыжок
больше viewport плюс overscan, включается `fitPerfectly`:

1. в первом кадре монтируется только минимальный диапазон около нового viewport;
2. anchor старого диапазона отключается, потому что содержимое полностью новое;
3. после быстрого первого paint ставится ещё один render;
4. второй кадр расширяет окно до обычного overscan.

Так первый кадр не тратит время на строки, находящиеся за пределами экрана.

См. [`CodeView.ts:3157–3186`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/components/CodeView.ts#L3157-L3186)
и повторный render в
[`CodeView.ts:3364–3369`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/components/CodeView.ts#L3364-L3369).

### 4. Overscan задаётся в пикселях

Окно вычисляется из `scrollTop`, viewport height и overscan, а затем переводится
в диапазон элементов. В простом virtualizer Pierre используется 1000 px overscan;
рядом в коде есть прямой комментарий, что такой запас нужен против Safari blanking.

- [`Virtualizer.ts:23–46`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/components/Virtualizer.ts#L23-L46);
- [`createWindowFromScrollPosition.ts`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/utils/createWindowFromScrollPosition.ts#L12-L48).

Advanced `CodeView` использует меньший overscan, потому что sticky scaffold и
двухфазный far-jump path уже защищают viewport.

### 5. DOM не должен меняться при каждом пикселе скролла

Scroll handler Pierre только помечает scroll state грязным и ставит render в
общую RAF-очередь. Текущий DOM сохраняется, пока viewport остаётся внутри уже
отрисованного окна. Диапазон переносится порциями при приближении к границе
overscan, а не на каждой строке или каждом пикселе.

См. [`CodeView.ts: handleScroll`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/components/CodeView.ts#L3530-L3538)
и [`UniversalRenderingManager.ts`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/managers/UniversalRenderingManager.ts).

### 6. Scroll anchor используется при изменении layout

Перед изменением высот Pierre запоминает первый видимый item или строку и её
смещение относительно viewport. После reconcile новая позиция сравнивается со
старой, а `scrollTop` корректируется на разницу.

Это нужно для variable-height content, annotations, wrapped lines и async
highlighting. Для обычных строк Anycode фиксированной высоты anchor не обязателен,
но понадобится, если высота отдельных visual rows станет переменной.

См. [`CodeView.ts:3100–3148`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/packages/diffs/src/components/CodeView.ts#L3100-L3148).

### 7. CSS containment

Контейнер приложения Pierre использует:

```css
contain: strict;
overflow-anchor: none;
will-change: scroll-position;
```

Rendered diff containers дополнительно ограничены через layout/paint/style
containment. Это уменьшает область style/layout/paint, но является дополнением к
scroll scaffold, а не самостоятельным решением blanking.

См. [`DiffsHubViewer.tsx`](https://github.com/pierrecomputer/pierre/blob/de681d76f0f940eb4a92976756d65b0adc22cc25/apps/diffshub/components/DiffsHubViewer.tsx#L468-L477).

## Архитектура, которую стоит перенести в Anycode

```text
.anyeditor (native scroll container)
├── .scroll-size       — стабильная полная высота документа
├── .render-layer      — один вертикальный sticky-контейнер
│   ├── .buttons       — horizontal sticky
│   ├── .gutter        — horizontal sticky
│   ├── .folds         — horizontal sticky
│   └── .code
└── .scrollbar-markers
```

Рекомендуемый render loop:

```text
passive scroll event
  -> сохранить scrollTop / поставить один RAF

RAF
  -> прочитать scrollTop и viewport один раз
  -> если viewport остаётся внутри overscan: ничего не менять в DOM
  -> если это далёкий прыжок: отрисовать только viewport
  -> иначе: порционно переместить render window
  -> синхронизировать один sticky render-layer
  -> после далёкого прыжка поставить второй RAF для overscan
```


Критические свойства решения:

- scrollbar всегда опирается на стабильную общую высоту;
- viewport никогда не зависит от пустого spacer внутри каждой колонки;
- все четыре колонки перемещаются одним вертикальным слоем;
- при медленном скролле браузер двигает существующий слой без DOM mutations;
- при далёком прыжке первый render минимален;
- buffer добавляется только после первого корректного paint.

## Что сохранить из текущих оптимизаций

Commit `4c973be` содержит полезный независимый baseline:

- `visualRows` не пересобираются во время обычного скролла;
- `updateContentMinWidth` не запускается из scroll render;
- scrollbar markers отключаются для файлов больше 5000 строк;
- используется `overflow-anchor: none`.

Эти оптимизации следует сохранить при переходе на новый scaffold, но сами по
себе они не устраняют compositor/main-thread race.

## Критерии готовности

- Дальний прыжок scrollbar сразу показывает строки около новой позиции.
- На промежуточных кадрах нет полностью пустого viewport.
- Медленный скролл Safari не вызывает DOM mutations на каждой строке.
- Gutter, folds, buttons и code всегда показывают один visual range.
- Горизонтальный scroll и sticky gutter продолжают работать.
- Cursor, selection, search и diagnostics переживают смену virtual window.
- Высота scrollbar не меняется при mount/unmount видимых строк.

