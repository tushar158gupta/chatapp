const mongoose = require('mongoose');
// const { toJSON } = require('../plugins');
// const { STATES_LIST } = require('../config/states.js');
const { toJSON } = require('./plugins');
const { STATES_LIST } = require('../config/states');

const traderSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
      sparse: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockedBy: {
      type: mongoose.Types.ObjectId,
      ref: 'Associates',
      default: null,
      sparse: true,
    },
    blockedDate: {
      type: Date,
      sparse: true,
    },
    blockedNote: {
      type: String,
      default: null,
    
    },
    password: {
      type: String,
      required: false,
    },
    role: {
      type: String,
      enum: ['TRADER'],
      default: 'TRADER',
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    mobile: {
      type: String,
      unique: true,
      sparse: true,
      validate: {
        validator: function (value) {
          return value || this.email;
        },
        message: 'Either mobile or email must be provided',
      },
    },
    isMobileVerified: {
      type: Boolean,
      default: false,
    },
    otp: String,
    otpExpires: Date,
    otpRequestCount: {
      type: Number,
      default: 0,
    },
    lastOtpRequestDate: Date,
    walletBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    riskProfileDone: {
      type: Boolean,
      default: false,
    },
    riskProfile: {
      type: [Object],
      required: false,
    },
    verificationEmailOtp: {
      type: String,
      required: false,
    },
    verificationEmailOtpExpires: {
      type: Date,
      required: false,
    },

    pendingEmail: {
      type: String,
      required: false,
    },

    profile: {
      type: new mongoose.Schema(
        {
          fName: {
            type: String,
            required: true,
          },
          lName: {
            type: String,
            required: true,
          },
          // pan: {
          //   type: String,
          //   required: true,
          // },
          address: {
            type: String,
            required: true,
          },
          city: {
            type: String,
            required: true,
          },
          state: {
            type: String,
            // required: true,
            enum: STATES_LIST,
          },
          pincode: {
            type: String,
            required: true,
          },
        },
        { _id: false }
      ),
      required: false, // <-- This makes the entire profile object optional
    },
  },
  { versionKey: false, timestamps: true }
);

// Add Partial Unique Index for Email
traderSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);

// Hide sensitive fields from JSON response
traderSchema.set('toJSON', {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.otp;
    delete ret.otpExpires;
    delete ret.verificationEmailOtp;
    delete ret.verificationEmailOtpExpires;
    delete ret.pendingEmail;
    return ret;
  },
});
// Add toJSON plugin
traderSchema.plugin(toJSON);

const Trader = mongoose.model('Trader', traderSchema, 'Trader');

module.exports = Trader;
