import Link from "next/link";
import { Suspense, useState } from "react";

import RegisterForm from "./register-form";

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-lg font-semibold text-[#173c32]">Loading registration...</div>}>
      <RegisterForm />
    </Suspense>
  );
}
