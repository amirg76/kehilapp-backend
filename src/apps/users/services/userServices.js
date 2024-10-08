import { Counter, userSchema } from '../dataAccess/userModel';

// { email: 1 }: This specifies that you want to create an index on the email field. The 1 means it's an ascending index, meaning emails will be indexed in increasing order.
// The collation { locale: 'en', strength: 2 } makes the uniqueness check case-insensitive for the email field.
userSchema.index({ email: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

userSchema.pre('save', async function (next) {
  //this.isNew: This condition checks if the document being saved is a new one
  if (this.isNew) {
    try {
      // { _id: 'userId' }: This specifies that you want to create an index on the _id field.
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'userId' },
        // { $inc: { seq: 1 } }: This increments the seq field by 1
        { $inc: { seq: 1 } },
        // { new: true, upsert: true }: This specifies that the updated document should be returned
        { new: true, upsert: true },
      );
      // { this.numericId = counter.seq }: This assigns the value of the seq field to the numericId field

      this.numericId = counter.seq;
    } catch (error) {
      return next(error);
    }
  }
  next();
});
