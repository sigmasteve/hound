import Foundation

// Hound's server, called straight from the watch (0189_apple_watch.sql):
// the pairing code, today's goals and water, and adding water; since 0274
// fasting (start and end) and logging an activity. Every call after
// pairing carries the watch's id and secret.

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

  // 0274. age: "ok" (16 or older), "under", or nil (not asked yet: the
  // phone asks on Fasting's first open).
  struct Fasting: Decodable {
    struct Open: Decodable {
      let started_at: String
      let goal_hours: Int
    }
    let age: String?
    let plan_hours: Int
    let open: Open?
    let streak: Int?

    var startedAt: Date? { open.flatMap { parseServerDate($0.started_at) } }
  }

  let name: String?
  let goals: [Goal]
  let water: Water?
  let streak: Streak?
  let fasting: Fasting?
}

// fasting_end's answer.
struct FastEnd: Decodable {
  let hours: Double
  let goal_hours: Int
  let on_plan: Bool
  let bones: Int?
  let streak: Int?
}

// log_workout's answer.
struct LoggedActivity: Decodable {
  let source_id: String
  let minutes: Int
  let name: String?
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

// A Postgres timestamp ("2026-11-25T18:32:00.123456+00:00"): ISO 8601,
// with the fraction cut to milliseconds, which the formatter reads.
func parseServerDate(_ s: String) -> Date? {
  var text = s.replacingOccurrences(of: " ", with: "T")
  if let dot = text.firstIndex(of: "."),
     let end = text[dot...].firstIndex(where: { $0 == "+" || $0 == "-" || $0 == "Z" }) {
    let fraction = text[text.index(after: dot)..<end]
    text.replaceSubrange(text.index(after: dot)..<end, with: String(fraction.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0))
  }
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let d = f.date(from: text) { return d }
  f.formatOptions = [.withInternetDateTime]
  return f.date(from: text)
}
