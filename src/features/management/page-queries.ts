import "server-only";

import { cache } from "react";

import {
  getDepartmentPeople,
  getPersonnelDetail,
} from "@/application/management/personnel-queries";
import { requireRequestContext } from "@/features/auth/guards";

import { managementPageRead } from "./page-read";

/** Request-only memoization lets the pre-stream guard and page share an authorized read. */
export const readPersonPage = cache(async (userId: string) =>
  managementPageRead(getPersonnelDetail(await requireRequestContext(), userId)),
);

export const readDepartmentPeoplePage = cache(async (code: string) =>
  managementPageRead(getDepartmentPeople(await requireRequestContext(), code)),
);
