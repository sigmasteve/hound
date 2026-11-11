import Foundation

// Hound's server, called straight from the watch (0189_apple_watch.sql):
// the pairing code, today's goals and water, and adding water. Every call
// after pairing carries the watch's id and secret.

struct WatchToday: Decodable {
  struct Goal: Decodable {
    let metric: String
    let period: String
    let target: Double
    let activity: String?
    let label: String?
  }

  struct Water: Decodable {
    let target_ml: Int
    let glass_ml: Int
    let units: String
    let today_ml: Int
  }

  struct Streak: Decodable {
    let streak: Int?
    let hit_today: Bool?
  }

  let name: String?
  let goals: [Goal]
  let water: Water?
  let streak: Streak?
}

struct PairStart: Decodable {
  let device_id: String
  let code: String
}

struct PairStatus: Decodable {
  let linked: Bool
  let expired: Bool?
  let name: String?
}

struct HoundError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

enum HoundAPI {
  // POST /rest/v1/rpc/<name> with the public key, as the website does.
  static func rpc<T: Decodable>(_ name: String, _ args: [String: Any], as type: T.Type) async throws -> T {
    guard let url = URL(string: "\(HoundConfig.apiURL)/rest/v1/rpc/\(name)") else {
      throw HoundError(message: "Hound's address is wrong in this build.")
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(HoundConfig.apiKey, forHTTPHeaderField: "apikey")
    request.httpBody = try JSONSerialization.data(withJSONObject: args)
    request.timeoutInterval = 20
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status >= 300 {
      if let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let message = body["message"] as? String {
        throw HoundError(message: message)
      }
      throw HoundError(message: "Hound couldn't be reached (\(status)). Try again.")
    }
    return try JSONDecoder().decode(T.self, from: data)
  }
}

// The watch's own id and secret, kept on the watch.
enum WatchIdentity {
  private static let deviceKey = "houndWatchDevice"
  private static let secretKey = "houndWatchSecret"

  static var deviceId: String? {
    get { UserDefaults.standard.string(forKey: deviceKey) }
    set { UserDefaults.standard.set(newValue, forKey: deviceKey) }
  }

  // Made once: 32 random bytes as hex.
  static var secret: String {
    if let s = UserDefaults.standard.string(forKey: secretKey) { return s }
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    let s = bytes.map { String(format: "%02x", $0) }.joined()
    UserDefaults.standard.set(s, forKey: secretKey)
    return s
  }

  static func forget() {
    UserDefaults.standard.removeObject(forKey: deviceKey)
  }
}

// The phone's idea of a day: yyyy-MM-dd here, where the watch is.
func localDayKey(_ date: Date = Date()) -> String {
  let f = DateFormatter()
  f.calendar = Calendar(identifier: .gregorian)
  f.locale = Locale(identifier: "en_US_POSIX")
  f.timeZone = TimeZone.current
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: date)
}
