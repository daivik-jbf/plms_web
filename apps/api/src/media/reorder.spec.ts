import { ConflictException } from '@nestjs/common';
import { ORDER_CHANGED_MESSAGE } from './media.schemas';
import { applyOrder } from './reorder';

describe('applyOrder', () => {
  const run = async (current: string[], ids: string[]) => {
    const writes: [string, number][] = [];
    const changed = await applyOrder(current, ids, async (id, position) => {
      writes.push([id, position]);
    });
    return { changed, writes };
  };

  it('writes every position when the order changed', async () => {
    expect(await run(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({
      changed: true,
      writes: [
        ['c', 0],
        ['a', 1],
        ['b', 2],
      ],
    });
  });

  it('writes nothing when the order is the same', async () => {
    expect(await run(['a', 'b'], ['a', 'b'])).toEqual({ changed: false, writes: [] });
    expect(await run([], [])).toEqual({ changed: false, writes: [] });
  });

  it.each([
    ['one missing', ['a', 'b', 'c'], ['a', 'b']],
    ['one unknown', ['a', 'b'], ['a', 'b', 'x']],
    ['one swapped for an unknown', ['a', 'b'], ['a', 'x']],
    ['one repeated', ['a', 'b', 'c'], ['a', 'a', 'b']],
    ['all repeated', ['a', 'b'], ['a', 'a']],
    ['nothing for a full list', ['a'], []],
    ['something for an empty list', [], ['a']],
  ])('refuses %s without writing anything', async (_name, current, ids) => {
    const writes: string[] = [];
    await expect(applyOrder(current, ids, async (id) => void writes.push(id))).rejects.toThrow(new ConflictException(ORDER_CHANGED_MESSAGE));
    expect(writes).toEqual([]);
  });
});
