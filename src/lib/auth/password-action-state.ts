export type PasswordActionState = {
  message: string | null;
  status: "error" | "idle" | "success";
};

export const initialPasswordActionState: PasswordActionState = {
  message: null,
  status: "idle"
};
