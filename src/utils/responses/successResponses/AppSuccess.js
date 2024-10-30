class AppSuccess {
  constructor(data = null, message = 'Success', statusCode = 200) {
    this.success = true;
    this.data = data;
    this.message = message;
    this.statusCode = statusCode;
  }
}

export default AppSuccess;
