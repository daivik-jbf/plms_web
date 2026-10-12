import { ConflictException } from '@nestjs/common';
import { ORDER_CHANGED_MESSAGE } from './media.schemas';

// `current` is the siblings' ids in the order they have now (read in SQL, after locking them); `ids` is the order the
// person asks for. It must contain exactly the same ids: nothing missing, nothing unknown, nothing twice, so a list that
// changed while someone was editing it is never silently reshuffled. When the order differs, `write` is called once per
// id with its new position (0, 1, 2 ...) and the answer is true; an unchanged order writes nothing and answers false.
export async function applyOrder(
  current: string[],
  ids: string[],
  write: (id: string, position: number) => Promise<unknown>,
): Promise<boolean> {
  const known = new Set(current);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id))) {
    throw new ConflictException(ORDER_CHANGED_MESSAGE);
  }
  if (ids.every((id, index) => id === current[index])) return false;
  for (const [index, id] of ids.entries()) await write(id, index);
  return true;
}
