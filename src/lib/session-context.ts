import { createContext, useContext } from "react";

// null means the initial browser session has not been resolved yet.
export const SignedInContext = createContext<boolean | null>(null);
export const useSignedIn = () => useContext(SignedInContext);