import "vitest/globals";

declare module "neverthrow" {
  interface ResultAsync<T, E> {
    _unsafeUnwrap(): T;
    _unsafeUnwrapErr(): E;
  }
}
