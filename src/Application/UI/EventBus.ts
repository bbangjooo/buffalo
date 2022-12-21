export const EventBus = {
  on(event: string, callback: (...args: any[]) => any) {
    // @ts-ignore
    document.addEventListener(event, (e) => callback(e.detail));
  },
  dispatch(event: string, data: any) {
    document.dispatchEvent(new CustomEvent(event, { detail: data }));
  },
};
