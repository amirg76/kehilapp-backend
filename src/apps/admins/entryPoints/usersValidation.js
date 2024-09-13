import { celebrate, Joi } from 'celebrate';
import pkg from 'joi';

const userSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const validateUser = async (req, res, next) => {
  try {
    userSchema.validate(req.body);
    next();
  } catch (error) {
    next(error);
  }
};

export const getUserByIdValidation = celebrate({
  params: Joi.object().keys({
    userId: Joi.string().required(),
  }),
});
