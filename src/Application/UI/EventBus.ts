export const EventBus = {
  on(event: string, callback: (...args: any[]) => any) {
    const listener = (e: Event) => callback((e as CustomEvent).detail);
    document.addEventListener(event, listener);
    return () => document.removeEventListener(event, listener);
  },
  dispatch(event: string, data: any) {
    document.dispatchEvent(new CustomEvent(event, { detail: data }));
  },
};
