export const l10n = {
  t(message: string, ...args: Array<string | number | boolean>): string {
    return args.reduce(
      (result, argument, index) =>
        result.replaceAll(`{${index}}`, String(argument)),
      message,
    );
  },
};
