import { type ComponentPropsWithoutRef, useLayoutEffect, useRef, useState } from 'react';

/** Room under a component for what is open on load (a dropdown or calendar with `open`), so it does not cover the next row.
 *  Measured once: what a click opens later is drawn over the content below, as on a real page. */
export function Room(props: ComponentPropsWithoutRef<'div'>) {
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const root = ref.current?.firstElementChild;
      if (!root) return;
      const bottom = root.getBoundingClientRect().bottom;
      let lowest = bottom;
      for (const node of root.querySelectorAll('*')) lowest = Math.max(lowest, node.getBoundingClientRect().bottom);
      setBelow(Math.ceil(lowest - bottom));
    };
    measure();
    document.fonts.ready.then(measure);
  }, []);
  return <div ref={ref} {...props} style={{ ...props.style, paddingBottom: below || undefined }} />;
}
