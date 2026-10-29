/** Sets `flag` while the request runs, so Android back is ignored like the code step's disabled Cancel (Vera #74 round 5). */
export function whileFlagged<Inputs extends unknown[], Result>(flag: { current: boolean }, request: (...inputs: Inputs) => Promise<Result>) {
  return (...inputs: Inputs): Promise<Result> => {
    flag.current = true;
    return request(...inputs).finally(() => (flag.current = false));
  };
}
