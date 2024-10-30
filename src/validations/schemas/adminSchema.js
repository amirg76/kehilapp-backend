import { Joi } from 'celebrate';
export const adminLoginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'פורמט דוא"ל לא חוקי',
    'string.empty': 'אימייל לא יכול להיות ריק',
    'any.required': 'יש צורך באימייל',
  }),
  password: Joi.string().required().min(8).messages({
    'string.empty': 'הסיסמה לא יכולה להיות ריקה',
    'any.required': 'נדרשת סיסמה',
    'string.min': 'הסיסמה חייבת להיות לפחות 8 תווים',
  }),
  role: Joi.string().valid('admin').default('admin').optional(),
});
