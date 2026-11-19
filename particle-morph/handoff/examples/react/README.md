# React / Next.js

1. Положите `ParticleMorphSection.jsx` рядом с папкой `particle-morph/`, например:
   ```
   src/components/ParticleMorphSection.jsx
   src/components/particle-morph/
   ```
   Или поправьте два пути `import('./particle-morph/...')` в файле.
2. Модели — в `public/models/`.
3. Используйте: `<ParticleMorphSection assetsBase="/" />`.

Next.js (App Router): файл уже помечен `'use client'`, three.js импортируется динамически внутри `useEffect`, SSR не затрагивается.
Компонент можно рендерить прямо из серверной страницы.
