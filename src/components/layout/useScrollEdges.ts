import { useEffect, useState, type RefObject } from 'react';

/** Which ends of a scrolling strip still hide items, so the strip can fade there as a hint. */
export function useScrollEdges(ref: RefObject<HTMLElement>, axis: 'x' | 'y') {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const update = () => {
      const position = axis === 'x' ? strip.scrollLeft : strip.scrollTop;
      const hidden = axis === 'x' ? strip.scrollWidth - strip.clientWidth : strip.scrollHeight - strip.clientHeight;
      const start = position > 1;
      const end = position < hidden - 1;
      setEdges(current => current.start === start && current.end === end ? current : { start, end });
    };
    update();
    strip.addEventListener('scroll', update, { passive: true });
    // Items arrive after modules and permissions load, without resizing the strip itself.
    const resize = new ResizeObserver(update);
    resize.observe(strip);
    const mutation = new MutationObserver(update);
    mutation.observe(strip, { childList: true, subtree: true });
    return () => {
      strip.removeEventListener('scroll', update);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref, axis]);
  return edges;
}
