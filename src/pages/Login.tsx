import { useSignIn, useSignUp } from "@clerk/clerk-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

type Step = "email" | "code";

const CODE_LENGTH = 6;

function friendlyCodeError(err: unknown): string {
  const errors = (err as { errors?: { code?: string; message?: string }[] })
    ?.errors;
  const code = errors?.[0]?.code;
  switch (code) {
    case "form_code_incorrect":
    case "verification_failed":
      return "That code isn't right. Double-check and try again.";
    case "verification_expired":
    case "form_code_expired":
      return "This code has expired. Send a new one to continue.";
    case "too_many_requests":
      return "Too many attempts. Wait a moment and try again.";
    case "form_param_format_invalid":
      return `Please enter all ${CODE_LENGTH} digits.`;
    default:
      return (
        errors?.[0]?.message ??
        (err instanceof Error ? err.message : "Something went wrong. Try again.")
      );
  }
}

export function Login() {
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isNewUser, setIsNewUser] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otpRef = useRef<HTMLInputElement>(null);

  const ready = signInLoaded && signUpLoaded;

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || !signIn || !signUp) return;
    setError(null);
    setSubmitting(true);

    try {
      try {
        await signIn.create({ identifier: email });
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: signIn.supportedFirstFactors!.find(
            (f) => f.strategy === "email_code"
          )!.emailAddressId,
        });
        setIsNewUser(false);
      } catch (err: unknown) {
        const errors = (err as { errors?: { code: string }[] })?.errors ?? [];
        if (errors.some((e) => e.code === "form_identifier_not_found")) {
          await signUp.create({ emailAddress: email });
          await signUp.prepareEmailAddressVerification({
            strategy: "email_code",
          });
          setIsNewUser(true);
        } else {
          throw err;
        }
      }
      setCode("");
      setStep("code");
    } catch (err: unknown) {
      const message =
        (err as { errors?: { message: string }[] })?.errors?.[0]?.message ??
        (err instanceof Error ? err.message : "Something went wrong");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyCode(submittedCode: string) {
    if (!ready || !signIn || !signUp) return;
    setError(null);
    setVerifying(true);
    try {
      if (isNewUser) {
        const result = await signUp.attemptEmailAddressVerification({
          code: submittedCode,
        });
        if (result.status === "complete") {
          await setActive({ session: result.createdSessionId });
          navigate("/", { replace: true });
          return;
        }
      } else {
        const result = await signIn.attemptFirstFactor({
          strategy: "email_code",
          code: submittedCode,
        });
        if (result.status === "complete") {
          await setActive({ session: result.createdSessionId });
          navigate("/", { replace: true });
          return;
        }
      }
      setError("Invalid verification state. Please try again.");
    } catch (err: unknown) {
      setError(friendlyCodeError(err));
      setCode("");
    } finally {
      setVerifying(false);
    }
  }

  // Refocus the OTP input after a failed verification — focus() won't take
  // while the input is still disabled, so wait until verifying flips off.
  useEffect(() => {
    if (step === "code" && error && !verifying) {
      otpRef.current?.focus();
    }
  }, [step, error, verifying]);

  function handleCodeChange(value: string) {
    setCode(value);
    setError(null);
    if (value.length === CODE_LENGTH) {
      void verifyCode(value);
    }
  }

  // Auto-focus OTP input when on code step or when tab regains visibility.
  useEffect(() => {
    if (step !== "code") return;

    otpRef.current?.focus();

    function onVisibility() {
      if (document.visibilityState === "visible") {
        otpRef.current?.focus();
      }
    }
    function onFocus() {
      otpRef.current?.focus();
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [step]);

  // Capture paste anywhere on the page during code step — even when OTP isn't focused.
  useEffect(() => {
    if (step !== "code") return;

    function onPaste(e: ClipboardEvent) {
      if (document.activeElement === otpRef.current) return;
      const text = e.clipboardData?.getData("text") ?? "";
      const digits = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
      if (digits.length === CODE_LENGTH) {
        e.preventDefault();
        otpRef.current?.focus();
        setCode(digits);
        setError(null);
        void verifyCode(digits);
      }
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isNewUser]);

  function resetToEmail() {
    setStep("email");
    setCode("");
    setError(null);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {step === "email" ? "Sign in to Finnear" : "Check your email"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {step === "email"
              ? "Enter your email — we'll create an account if you don't have one."
              : `We sent a ${CODE_LENGTH}-digit code to ${email}.`}
          </p>
        </div>

        {step === "email" ? (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div id="clerk-captcha" />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={!ready || submitting || !email}
            >
              {submitting ? "Sending code…" : "Continue"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <InputOTP
                ref={otpRef}
                maxLength={CODE_LENGTH}
                value={code}
                onChange={handleCodeChange}
                disabled={verifying}
                autoFocus
              >
                {Array.from({ length: CODE_LENGTH }).map((_, i) => (
                  <InputOTPGroup key={i}>
                    <InputOTPSlot index={i} />
                  </InputOTPGroup>
                ))}
              </InputOTP>
            </div>
            {error && (
              <p
                key={error}
                role="alert"
                className="text-sm text-destructive text-center animate-in fade-in slide-in-from-top-1 duration-200"
              >
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2 text-center text-sm">
              <button
                type="button"
                onClick={resetToEmail}
                className="text-muted-foreground hover:text-foreground"
              >
                Use a different email
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
