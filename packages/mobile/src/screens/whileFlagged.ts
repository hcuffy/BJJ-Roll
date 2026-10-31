export function whileFlagged<Inputs extends unknown[], Result>(flag: { current: boolean }, request: (...inputs: Inputs) => Promise<Result>) {
  return (...inputs: Inputs): Promise<Result> => {
    flag.current = true;
    return request(...inputs).finally(() => (flag.current = false));
  };
}
