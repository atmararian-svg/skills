'use client'; // Next.js App Router: только клиент. В обычном React эта строка ни на что не влияет.

import { useEffect, useRef, useState } from 'react';

/**
 * Секция с 3D-скульптурой из частиц (5 объектов, морфинг по прокрутке).
 *
 *   <ParticleMorphSection assetsBase="/" />
 *
 * assetsBase — адрес папки, в которой лежит models/ (модели в public/models → "/").
 * Путь импорта ниже поправьте под место, куда скопирована папка particle-morph/.
 */
export default function ParticleMorphSection({ assetsBase = '/', scrollLength = '900vh', className }) {
  const sectionRef = useRef(null);
  const stageRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error

  useEffect(() => {
    let disposed = false;
    let scene = null;
    let scroll = null;
    let visible = false;

    async function init() {
      setStatus('loading');
      // динамический импорт: three.js не попадает в SSR и в основной бандл страницы
      const [{ ParticleMorphScene, SHOWCASE_MODELS }, { ScrollController }] = await Promise.all([
        import('./particle-morph/index.js'),
        import('./particle-morph/ScrollController.js'),
      ]);
      if (disposed) return;
      scene = new ParticleMorphScene(stageRef.current, {
        models: SHOWCASE_MODELS(assetsBase),
        cssBlendTarget: 'container', // stage — sticky-блок, наложение вешаем на него
      });
      await scene.load(); // если компонент размонтирован во время загрузки, dispose() прервёт её
      if (disposed) return;
      scroll = new ScrollController({
        trigger: sectionRef.current,
        start: 'top top',
        end: 'bottom bottom',
        scrub: 0.8,
        onUpdate: (p) => scene.setMorphProgress(p),
      });
      if (!visible) scene.stop();
      setStatus('ready');
    }

    // 1) грузим заранее: когда до секции остаётся ~1 экран
    const preload = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        preload.disconnect();
        init().catch((e) => {
          if (!disposed) setStatus('error');
          console.error(e);
        });
      },
      { rootMargin: '100% 0px' },
    );
    preload.observe(sectionRef.current);
    // 2) анимация работает только пока секция реально на экране
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (scene?.ready) (visible ? scene.start() : scene.stop());
    });
    visibility.observe(sectionRef.current);

    return () => {
      disposed = true;
      preload.disconnect();
      visibility.disconnect();
      scroll?.dispose();
      scene?.dispose();
    };
  }, [assetsBase]);

  return (
    <section ref={sectionRef} className={className} style={{ height: scrollLength, position: 'relative' }}>
      {/* У родителей этого блока не должно быть transform / filter / opacity / isolation / z-index (см. INTEGRATION.md) */}
      <div ref={stageRef} style={{ position: 'sticky', top: 0, height: '100vh' }}>
        {status !== 'ready' && (
          <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', opacity: 0.5 }}>
            {status === 'error' ? 'не удалось загрузить 3D' : 'загрузка…'}
          </span>
        )}
      </div>
    </section>
  );
}
