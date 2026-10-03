"use client";

import { ShieldAlert } from "lucide-react";
import { useState } from "react";

import type { PersonnelUser } from "@/application/management/read-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionHeader } from "@/components/ui/section-header";

import { setHospitalAdminAction } from "./actions";
import { authorityConfirmation } from "./authority-presentation";
import { MutationDialog } from "./mutation-dialog";

type Account = Pick<
  PersonnelUser,
  "id" | "displayName" | "isHospitalAdmin" | "isActive"
>;

function AuthorityDialog({
  user,
  self,
  close,
  success,
}: {
  user: Account;
  self: boolean;
  close: () => void;
  success: (message: string) => void;
}) {
  const [snapshot] = useState(user);
  const copy = authorityConfirmation({ ...snapshot, self });
  return (
    <MutationDialog
      title={copy.title}
      description={snapshot.displayName}
      submitLabel={copy.title}
      action={setHospitalAdminAction}
      onClose={close}
      onSuccess={success}
      destructive={copy.removing}
    >
      {() => (
        <>
          <input type="hidden" name="userId" value={snapshot.id} />
          <input
            type="hidden"
            name="isHospitalAdmin"
            value={String(!snapshot.isHospitalAdmin)}
          />
          <input
            type="hidden"
            name="expectedIsHospitalAdmin"
            value={String(snapshot.isHospitalAdmin)}
          />
          <input
            type="hidden"
            name="expectedIsActive"
            value={String(snapshot.isActive)}
          />
          <Callout
            icon={ShieldAlert}
            tone={copy.removing || !snapshot.isActive ? "attention" : "info"}
          >
            {copy.warning && (
              <strong className="mb-2 block">
                هشدار: حذف اختیار مدیریتی خود
              </strong>
            )}
            {copy.description}
          </Callout>
          <p className="text-sm">
            آیا {copy.removing ? "حذف" : "اعطای"} نقش مدیریتی این کاربر تأیید
            می‌شود؟
          </p>
        </>
      )}
    </MutationDialog>
  );
}

export function AuthorityControls({
  user,
  actorId,
}: {
  user: Account;
  actorId: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const copy = authorityConfirmation({ ...user, self: user.id === actorId });
  return (
    <section
      aria-labelledby="system-authority"
      className="space-y-4 rounded-xl border bg-card p-5"
    >
      <SectionHeader
        id="system-authority"
        title="نقش مدیریتی سیستم"
        icon={<ShieldAlert aria-hidden="true" />}
      />
      <Badge tone={user.isHospitalAdmin ? "brand-soft" : "muted"}>
        {user.isHospitalAdmin ? "مدیر بیمارستان" : "بدون نقش مدیر بیمارستان"}
      </Badge>
      <p className="text-sm text-muted-foreground">
        اختیار مدیریتی مستقل از فعال بودن حساب، عضویت‌های بخش و دسترسی سوپروایزر
        است.
      </p>
      {user.isHospitalAdmin && !user.isActive && (
        <p className="text-sm text-muted-foreground">
          نقش ذخیره شده است؛ تا فعال‌سازی صریح حساب دسترسی نمی‌دهد.
        </p>
      )}
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {copy.title}
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {open && (
        <AuthorityDialog
          user={user}
          self={user.id === actorId}
          close={() => setOpen(false)}
          success={setMessage}
        />
      )}
    </section>
  );
}
