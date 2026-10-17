import { hypo } from "./format";

const OUTER = hypo(30, 11, 15, 46, 900);
const INNER = hypo(20, 8, 9, 30, 700);

/** The Paritas guilloché mark (prototype `.js-mark`). Server-rendered so the client never recomputes the paths. */
export function Mark() {
  return (
    <svg className="js-mark" viewBox="-50 -50 100 100" aria-hidden="true">
      <path d={OUTER} fill="none" stroke="url(#silver)" strokeWidth="2.6" />
      <path d={INNER} fill="none" stroke="#F5F5F7" strokeWidth="2.6" opacity=".45" />
    </svg>
  );
}
