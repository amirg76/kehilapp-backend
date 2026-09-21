/**
 * The message title is capped in the SCHEMA, not only on the HTTP route.
 *
 * WHAT WENT WRONG. `messagesValidation.js` capped `title` at
 * messageConstants.titleMaxLength on every route, and the mongoose schema capped
 * it nowhere. The two layers therefore disagreed: a title the API refused with
 * 400 was stored without complaint by anything that did not go through the API —
 * `Message.create` from a script, the demo seed, a future background job. The
 * cap looked enforced while the storage layer had no opinion at all.
 *
 * So this suite asserts at the layer the gap was in. It calls the MODEL directly
 * and never touches Express: if the assertion below can only be made through a
 * request, it is testing Joi again and would have stayed green through the whole
 * bug. 26 characters is used because it is the smallest value the cap must
 * reject — a test written against 500 characters passes against a cap of 400 too.
 *
 * The seed is covered elsewhere: seedDemoPasswords.int.test.js spawns
 * scripts/seedDemo.js for real and requires exit 0, so a seeded title that
 * outgrows this cap fails there rather than silently at demo time.
 */
import Message from '../apps/messages/dataAccess/messageModel.js';
import { messageConstants } from '../config/validationConstants.js';

const LIMIT = messageConstants.titleMaxLength;

// Plain ASCII on purpose. Both Joi's `.max()` and mongoose's `maxlength` count
// UTF-16 code units, so a Hebrew title of N characters and an ASCII one of N
// characters are measured identically — and an ASCII literal lets a reader count
// the length by eye instead of trusting the comment.
const titleOfLength = (n) => 'a'.repeat(n);

const baseMessage = {
  categoryId: 'cat-title-length',
  // senderId is required on the model: every message has an author.
  senderId: '000000000000000000000001',
  text: 'גוף ההודעה',
};

afterEach(async () => {
  await Message.deleteMany({});
});

describe('message title length is enforced by the model', () => {
  it('rejects a title one character over the limit', async () => {
    const overLong = { ...baseMessage, title: titleOfLength(LIMIT + 1) };

    // The schema's post-save hook (applyErrorHandlingMiddleware) replaces the
    // mongoose ValidationError with a flat AppError, so `create` cannot report
    // WHICH field failed. Two assertions therefore share the work: this one
    // proves nothing was written, and `validateSync` below names the field and
    // the rule — without it, "it threw" would also be satisfied by a missing
    // required field or a cast error, and would pass with no cap at all.
    await expect(Message.create(overLong)).rejects.toMatchObject({
      message: 'Validation Error',
    });

    expect(await Message.countDocuments()).toBe(0);

    const detail = new Message(overLong).validateSync();
    expect(detail.errors.title).toMatchObject({ kind: 'maxlength', path: 'title' });
  });

  it('accepts a title exactly at the limit', async () => {
    // The other half of the boundary. Without it, a cap set one too low would
    // satisfy the test above and quietly refuse titles the route accepts —
    // the same layer disagreement, pointing the other way.
    const doc = await Message.create({ ...baseMessage, title: titleOfLength(LIMIT) });

    expect(doc.title).toHaveLength(LIMIT);
  });

  it('measures a Hebrew title the same way the route does', async () => {
    // Every real title in this application is Hebrew, and the bug was found on a
    // Hebrew seed title. Hebrew letters are single UTF-16 code units, so this
    // must fail at exactly the same length as the ASCII case above.
    const hebrew = 'א'.repeat(LIMIT + 1);

    await expect(Message.create({ ...baseMessage, title: hebrew })).rejects.toMatchObject({
      message: 'Validation Error',
    });

    const detail = new Message({ ...baseMessage, title: hebrew }).validateSync();
    expect(detail.errors.title).toMatchObject({ kind: 'maxlength', path: 'title' });
  });
});
